import {
  BranchRuleTypeSchema,
  REPOSITORY_CHECK_IDS,
  ScorecardCheckSchema,
  type BranchRuleType,
  type Policies,
  type Reason,
  type RepositoryCheckId,
  type RepositoryCheckState,
  type RepositoryControlsHealth,
  type ScorecardCheck,
} from '@model/index';
import {
  MAX_REFS_PER_REPO,
  reusableStatus,
  type ParsedWorkflow,
  type TargetVersions,
  type UsesRef,
} from '../normalizers/workflow-refs';
import type {
  BranchRuleDTO,
  ClassicProtectionDTO,
  CodeScanningAnalysisDTO,
  ProviderResult,
} from '../providers/types';
import { reason } from './health';

/*
 * Repository controls: six named checks per unique repository, built from the parsed workflow
 * references and the branch rules API. Pure. Anti-goals: a repository whose workflows or rules
 * cannot be read is never `pass` and never `fail`: it is `unknown`.
 */

export interface RepoControlsInput {
  repository: string;
  componentIds: string[];
  /** Default branch the rules were read for; null when unavailable. */
  branch: string | null;
  available: boolean; // repository metadata ok
  archived: boolean;
  notApplicable: RepositoryCheckId[]; // already intersected across targets (monorepo rule)
  workflows:
    | { state: 'none' } // .github/workflows 404
    | { state: 'not-authorised' | 'unknown' }
    | { state: 'read'; files: ParsedWorkflow[]; unreadable: number; capped: boolean };
  reusable: Map<string, TargetVersions>; // key `${owner}/${repo}`.toLowerCase()
  rules: ProviderResult<BranchRuleDTO[]>;
  protected: boolean | null;
  classic: ProviderResult<ClassicProtectionDTO | null> | null; // null = not read
  scorecardAnalysis: ProviderResult<CodeScanningAnalysisDTO | null>;
  scorecardAlerts: { ruleId: string | null }[] | null; // open, tool Scorecard; null = not readable
  publicDetails: boolean; // false → unpinnedRefs withheld
  repositoryUrlFor: (target: string) => string | null; // sanitised https://github.com/owner/repo
}

type RepoEntry = RepositoryControlsHealth['repositories'][number];
type Level = 'info' | 'amber' | 'red';

const MAX_LISTED = 20;
const MAX_NAMED_REPOSITORIES = 10;
const RULE_TYPES: readonly string[] = BranchRuleTypeSchema.options;

const ratioOf = (passed: number, failed: number): number | null =>
  passed + failed > 0 ? Math.round((passed / (passed + failed)) * 100) : null;

const tally = (states: RepositoryCheckState[]) => ({
  passed: states.filter((s) => s === 'pass').length,
  failed: states.filter((s) => s === 'fail').length,
  unknown: states.filter((s) => s === 'unknown').length,
  notApplicable: states.filter((s) => s === 'not-applicable').length,
});

// ---------------------------------------------------------------------------------------------
// Actions and reusable workflows
// ---------------------------------------------------------------------------------------------

interface CountedRef extends UsesRef {
  workflow: string;
}

const isExempt = (r: UsesRef, exempt: Set<string>) =>
  r.owner !== null && exempt.has(r.owner.toLowerCase());

interface ActionsResult {
  actions: RepoEntry['actions'];
  state: RepositoryCheckState;
  /** True when every workflow file was read and parsed completely. */
  complete: boolean;
  counted: CountedRef[];
}

function evaluateActions(input: RepoControlsInput, policies: Policies): ActionsResult {
  const withheld = !input.publicDetails;
  const base = {
    detailsWithheld: withheld,
    unpinnedRefs: [] as RepoEntry['actions']['unpinnedRefs'],
    truncated: 0,
  };
  const nulls = { workflowFiles: null, total: null, pinned: null, unpinned: null, unknown: null };
  const w = input.workflows;
  if (w.state === 'none') {
    return {
      actions: {
        state: 'none',
        workflowFiles: 0,
        total: 0,
        pinned: 0,
        unpinned: 0,
        unknown: 0,
        ...base,
      },
      state: 'not-applicable',
      complete: true,
      counted: [],
    };
  }
  if (w.state !== 'read') {
    return {
      actions: { state: w.state, ...nulls, ...base },
      state: 'unknown',
      complete: false,
      counted: [],
    };
  }

  const exempt = new Set(
    policies.repositoryControls.exemptActionOwners.map((o) => o.toLowerCase()),
  );
  const all: CountedRef[] = w.files.flatMap((f) =>
    f.refs.filter((r) => r.kind !== 'local').map((r) => ({ ...r, workflow: f.file })),
  );
  const repoCapped = w.capped || w.files.some((f) => f.capped) || all.length > MAX_REFS_PER_REPO;
  const counted = all.slice(0, MAX_REFS_PER_REPO);
  const invalid = counted.filter((r) => r.kind === 'invalid');
  const valid = counted.filter((r) => r.kind !== 'invalid');
  const unpinned = valid.filter((r) => !r.pinned && !isExempt(r, exempt));
  const unparsable = w.files.filter((f) => f.unparsable).length;
  const complete = w.unreadable === 0 && unparsable === 0 && !repoCapped;

  let state: RepositoryCheckState;
  if (unpinned.length > 0) state = 'fail';
  else if (!complete || invalid.length > 0) state = 'unknown';
  else if (counted.length === 0) state = 'not-applicable';
  else state = 'pass';

  const listed = withheld
    ? []
    : unpinned.slice(0, MAX_LISTED).map((r) => ({
        workflow: r.workflow,
        kind: r.kind as 'action' | 'reusable-workflow' | 'docker',
        target: r.target ?? '',
        ref: r.ref ?? '',
      }));
  return {
    actions: {
      state: complete ? 'available' : 'partial',
      workflowFiles: w.files.length + w.unreadable,
      // A cut-off list makes every count a lower bound: unknown, never a smaller number.
      total: repoCapped ? null : counted.length,
      pinned: repoCapped ? null : valid.length - unpinned.length,
      unpinned: repoCapped ? null : unpinned.length,
      unknown: repoCapped ? null : invalid.length,
      detailsWithheld: withheld,
      unpinnedRefs: listed,
      truncated: withheld ? 0 : Math.max(0, unpinned.length - MAX_LISTED),
    },
    state,
    complete,
    counted,
  };
}

function evaluateReusable(
  input: RepoControlsInput,
  actions: ActionsResult,
): { list: RepoEntry['reusableWorkflows']; state: RepositoryCheckState } {
  const w = input.workflows;
  if (w.state === 'none') return { list: [], state: 'not-applicable' };
  if (w.state !== 'read') return { list: [], state: 'unknown' };

  const seen = new Set<string>();
  const rows: RepoEntry['reusableWorkflows'] = [];
  for (const r of actions.counted) {
    if (r.kind !== 'reusable-workflow' || !r.target || !r.owner || !r.repo || r.ref === null)
      continue;
    const key = `${r.workflow}|${r.target}|${r.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const versions = input.reusable.get(`${r.owner}/${r.repo}`.toLowerCase());
    const res = versions
      ? reusableStatus(r.ref, versions)
      : { status: 'unknown' as const, latest: null };
    rows.push({
      workflow: r.workflow,
      target: r.target,
      ref: r.ref,
      latest: res.latest,
      status: res.status,
      url: versions?.visible ? input.repositoryUrlFor(`${r.owner}/${r.repo}`) : null,
    });
  }
  const list = input.publicDetails ? rows.slice(0, MAX_LISTED) : [];

  let state: RepositoryCheckState;
  if (rows.some((r) => r.status === 'behind')) state = 'fail';
  else if (rows.length === 0) state = actions.complete ? 'not-applicable' : 'unknown';
  else if (!actions.complete || rows.some((r) => r.status !== 'current')) state = 'unknown';
  else state = 'pass';
  return { list, state };
}

// ---------------------------------------------------------------------------------------------
// Branch rules
// ---------------------------------------------------------------------------------------------

function evaluateBranch(input: RepoControlsInput): {
  summary: RepoEntry['branchRules'];
  states: Record<
    'branch-protected' | 'pull-request-required' | 'force-push-blocked' | 'status-checks-required',
    RepositoryCheckState
  >;
} {
  const rulesOk = input.rules.ok;
  const rules = input.rules.ok ? input.rules.data : [];
  const classicRead = input.classic !== null && input.classic.ok;
  const classic = input.classic && input.classic.ok ? input.classic.data : null;
  const hasRules = rules.length > 0;
  const types = [...new Set(rules.map((r) => r.type))];
  const named = types.filter((t) => RULE_TYPES.includes(t)) as BranchRuleType[];
  const otherRules = rules.filter((r) => !RULE_TYPES.includes(r.type)).length;
  const approvals = [
    ...rules.filter((r) => r.type === 'pull_request').map((r) => r.requiredApprovals),
    classic?.requiredApprovals ?? null,
  ].filter((n): n is number => n !== null);
  const requiredApprovals = approvals.length ? Math.min(10, Math.max(0, ...approvals)) : null;

  let source: RepoEntry['branchRules']['source'];
  if (hasRules && classic) source = 'both';
  else if (hasRules) source = 'rulesets';
  else if (classic) source = 'classic';
  else if (rulesOk && input.protected === true && !classicRead)
    source = 'classic'; // inferred from `protected` (only when the rules call answered)
  else if (rulesOk && input.protected === false) source = 'none';
  else if (rulesOk && classicRead && input.protected !== true) source = 'none';
  else source = 'unknown';

  const protectedFlag = input.protected;
  const has = (type: string, classicHas: boolean | undefined) =>
    rules.some((r) => r.type === type) || classicHas === true;
  /** Checks 4–6 share one rule (spec §5.4). */
  const shared = (present: boolean): RepositoryCheckState => {
    if (present) return 'pass';
    if (!rulesOk) return 'unknown';
    if (protectedFlag === false && !classic) return 'fail';
    // Classic protection answered 404 while the branch reports protected and no rule explains
    // it: a contradiction, most likely a permission ambiguity. Unknown, never fail.
    if (classicRead && classic === null && protectedFlag === true && !hasRules) return 'unknown';
    if (classicRead) return 'fail'; // classic protection was read and lacks it
    return 'unknown'; // protected true / null and classic not read (D6)
  };

  const protectedState: RepositoryCheckState =
    hasRules || classic || protectedFlag === true
      ? 'pass'
      : rulesOk && protectedFlag === false && (!classicRead || classic === null)
        ? 'fail'
        : 'unknown';

  const rulesState: RepoEntry['branchRules']['state'] = input.rules.ok
    ? 'available'
    : input.rules.error.classification === 'not-authorised'
      ? 'not-authorised'
      : 'unknown';

  return {
    summary: {
      state: rulesState,
      branch: input.branch,
      protected: protectedFlag,
      source,
      ruleTypes: named,
      otherRules,
      requiredApprovals,
      classicRead,
    },
    states: {
      'branch-protected': protectedState,
      'pull-request-required': shared(has('pull_request', classic?.pullRequestReviews)),
      'force-push-blocked': shared(has('non_fast_forward', classic?.forcePushBlocked)),
      'status-checks-required': shared(has('required_status_checks', classic?.statusChecks)),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Scorecard
// ---------------------------------------------------------------------------------------------

const normaliseRuleId = (s: string) =>
  s
    .replace(/ID$/, '')
    .replace(/[^A-Za-z]/g, '')
    .toLowerCase();
const SCORECARD_BY_RULE = new Map<string, ScorecardCheck>(
  ScorecardCheckSchema.options.map((c) => [normaliseRuleId(c), c]),
);

function evaluateScorecard(input: RepoControlsInput): RepoEntry['scorecard'] {
  const a = input.scorecardAnalysis;
  let state: RepoEntry['scorecard']['state'];
  if (a.ok) state = a.data ? 'available' : 'not-used';
  else if (a.error.classification === 'not-authorised') state = 'not-authorised';
  else if (a.error.classification === 'not-found') state = 'not-used';
  else state = 'unknown';

  const alerts = input.scorecardAlerts;
  const failing: ScorecardCheck[] = [];
  const other = new Set<string>();
  for (const alert of alerts ?? []) {
    const check = alert.ruleId ? SCORECARD_BY_RULE.get(normaliseRuleId(alert.ruleId)) : undefined;
    if (check) {
      if (!failing.includes(check)) failing.push(check);
    } else other.add(alert.ruleId ?? '');
  }
  return {
    state,
    lastAnalysisAt: a.ok && a.data ? a.data.createdAt : null,
    openAlerts: alerts === null ? null : alerts.length,
    failingChecks: failing,
    otherFailing: other.size,
  };
}

// ---------------------------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------------------------

export function evaluateRepositoryChecks(input: RepoControlsInput, policies: Policies): RepoEntry {
  const actions = evaluateActions(input, policies);
  const reusable = evaluateReusable(input, actions);
  const branch = evaluateBranch(input);

  let computed: Record<RepositoryCheckId, RepositoryCheckState> = {
    'actions-pinned': actions.state,
    'reusable-workflows-current': reusable.state,
    ...branch.states,
  };
  if (!input.available) {
    computed = Object.fromEntries(
      REPOSITORY_CHECK_IDS.map((id) => [id, 'unknown']),
    ) as typeof computed;
  } else if (input.archived) {
    computed = Object.fromEntries(
      REPOSITORY_CHECK_IDS.map((id) => [id, 'not-applicable']),
    ) as typeof computed;
  } else {
    for (const id of input.notApplicable) computed[id] = 'not-applicable';
  }

  const checks = REPOSITORY_CHECK_IDS.map((id) => ({ id, state: computed[id] }));
  const counts = tally(checks.map((c) => c.state));

  if (!input.available) {
    return {
      componentIds: input.componentIds,
      repository: input.repository,
      checks,
      ...counts,
      ratio: null,
      actions: {
        state: 'unknown',
        workflowFiles: null,
        total: null,
        pinned: null,
        unpinned: null,
        unknown: null,
        detailsWithheld: !input.publicDetails,
        unpinnedRefs: [],
        truncated: 0,
      },
      reusableWorkflows: [],
      branchRules: {
        state: 'unknown',
        branch: null,
        protected: null,
        source: 'unknown',
        ruleTypes: [],
        otherRules: 0,
        requiredApprovals: null,
        classicRead: false,
      },
      scorecard: {
        state: 'unknown',
        lastAnalysisAt: null,
        openAlerts: null,
        failingChecks: [],
        otherFailing: 0,
      },
    };
  }

  return {
    componentIds: input.componentIds,
    repository: input.repository,
    checks,
    ...counts,
    ratio: ratioOf(counts.passed, counts.failed),
    actions: actions.actions,
    reusableWorkflows: reusable.list,
    branchRules: branch.summary,
    scorecard: evaluateScorecard(input),
  };
}

// ---------------------------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------------------------

const namedRepositories = (names: string[]) =>
  names.length > MAX_NAMED_REPOSITORIES
    ? `${names.slice(0, MAX_NAMED_REPOSITORIES).join(', ')} +${names.length - MAX_NAMED_REPOSITORIES}`
    : names.join(', ');

export function evaluateRepositoryControls(
  repos: RepoEntry[],
  policies: Policies,
  collectedAt: string,
): { health: RepositoryControlsHealth; reasons: Reason[] } {
  const pc = policies.repositoryControls;
  const level = (id: RepositoryCheckId): Level => pc.checks[id];
  if (!pc.enabled) {
    return {
      health: {
        enabled: false,
        collectedAt,
        passed: 0,
        failed: 0,
        unknown: 0,
        notApplicable: 0,
        ratio: null,
        perCheck: REPOSITORY_CHECK_IDS.map((id) => ({
          id,
          level: level(id),
          passed: 0,
          failed: 0,
          unknown: 0,
          notApplicable: 0,
        })),
        repositories: [],
      },
      reasons: [],
    };
  }

  const perCheck = REPOSITORY_CHECK_IDS.map((id) => ({
    id,
    level: level(id),
    ...tally(repos.map((r) => r.checks.find((c) => c.id === id)?.state ?? 'unknown')),
  }));
  const total = {
    passed: perCheck.reduce((n, c) => n + c.passed, 0),
    failed: perCheck.reduce((n, c) => n + c.failed, 0),
    unknown: perCheck.reduce((n, c) => n + c.unknown, 0),
    notApplicable: perCheck.reduce((n, c) => n + c.notApplicable, 0),
  };

  const reasons: Reason[] = [];
  for (const c of perCheck) {
    const withState = (state: RepositoryCheckState) =>
      repos
        .filter((r) => r.checks.find((x) => x.id === c.id)?.state === state)
        .map((r) => r.repository);
    if (c.failed > 0) {
      reasons.push(
        reason('repository-check-failed', c.level, {
          check: c.id,
          repositories: namedRepositories(withState('fail')),
          count: c.failed,
        }),
      );
    }
    if (c.level !== 'info' && c.unknown > 0) {
      reasons.push(
        reason('repository-check-unknown', pc.unknownEnforcedCheck, {
          check: c.id,
          repositories: namedRepositories(withState('unknown')),
          count: c.unknown,
        }),
      );
    }
  }
  if (total.failed === 0 && total.unknown === 0 && total.passed > 0)
    reasons.push(reason('repository-checks-passed', 'info'));

  return {
    health: {
      enabled: true,
      collectedAt,
      ...total,
      ratio: ratioOf(total.passed, total.failed),
      perCheck,
      repositories: repos,
    },
    reasons,
  };
}
