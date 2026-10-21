import { describe, expect, it } from 'vitest';
import type { Policies, RepositoryCheckId, RepositoryCheckState } from '@model/index';
import {
  evaluateRepositoryChecks,
  evaluateRepositoryControls,
  type RepoControlsInput,
} from '../../collector/src/evaluators/repository-controls';
import { evaluateGovernance } from '../../collector/src/evaluators/health';
import {
  classifyUses,
  type ParsedWorkflow,
  type TargetVersions,
} from '../../collector/src/normalizers/workflow-refs';
import { fail, ok } from '../../collector/src/providers/types';
import { NOW, policies, workflow } from '../helpers/factories';

const A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const B = 'b2c3d4e5f60718293a4b5c6d7e8f901234567890';
const C = 'c3d4e5f60718293a4b5c6d7e8f9012345678901a';
const D = '0123456789abcdef0123456789abcdef01234567';
const COLLECTED_AT = NOW.toISOString();

const ids: RepositoryCheckId[] = [
  'actions-pinned',
  'reusable-workflows-current',
  'branch-protected',
  'pull-request-required',
  'force-push-blocked',
  'status-checks-required',
];

const wf = (file: string, ...uses: string[]): ParsedWorkflow => ({
  file,
  refs: uses.map(classifyUses),
  capped: false,
  unparsable: false,
});
const read = (files: ParsedWorkflow[], extra: { unreadable?: number; capped?: boolean } = {}) =>
  ({ state: 'read', files, unreadable: 0, capped: false, ...extra }) as const;

const ciTemplates: TargetVersions = {
  latest: 'v2.4.0',
  tags: [
    { name: 'v2.4.0', sha: A },
    { name: 'v2.3.0', sha: B },
    { name: 'v2.1.0', sha: C },
  ],
  visible: true,
};
const FOUR_RULES = [
  { type: 'pull_request', requiredApprovals: 2 },
  { type: 'required_status_checks', requiredApprovals: null },
  { type: 'non_fast_forward', requiredApprovals: null },
  { type: 'deletion', requiredApprovals: null },
];

function controlsInput(partial: Partial<RepoControlsInput> = {}): RepoControlsInput {
  return {
    repository: 'example-org/svc',
    componentIds: ['coordinator'],
    branch: 'main',
    available: true,
    archived: false,
    notApplicable: [],
    workflows: read([wf('ci.yml', `actions/checkout@${D}`)]),
    reusable: new Map([['example-shared/ci-templates', ciTemplates]]),
    rules: ok(FOUR_RULES),
    protected: true,
    classic: null,
    scorecardAnalysis: ok(null),
    scorecardAlerts: [],
    publicDetails: true,
    repositoryUrlFor: (t) => `https://github.com/${t}`,
    ...partial,
  };
}
const P = policies();
const states = (partial: Partial<RepoControlsInput>, p: Policies = P) => {
  const r = evaluateRepositoryChecks(controlsInput(partial), p);
  return Object.fromEntries(r.checks.map((c) => [c.id, c.state])) as Record<
    RepositoryCheckId,
    RepositoryCheckState
  >;
};
const repo = (partial: Partial<RepoControlsInput> = {}) =>
  evaluateRepositoryChecks(controlsInput(partial), P);
const reusableRef = (ref: string) =>
  `example-shared/ci-templates/.github/workflows/build.yml@${ref}`;

describe('actions-pinned', () => {
  const check = (partial: Partial<RepoControlsInput>, p?: Policies) =>
    states(partial, p)['actions-pinned'];
  it('3 pinned refs → pass', () =>
    expect(
      check({ workflows: read([wf('ci.yml', ...['a/x', 'b/y', 'c/z'].map((t) => `${t}@${D}`))]) }),
    ).toBe('pass'));
  it('1 unpinned of 4 → fail even with 1 unreadable file', () => {
    const r = repo({
      workflows: read([wf('ci.yml', `a/x@${D}`, `b/y@${D}`, `c/z@${D}`, 'actions/checkout@v4')], {
        unreadable: 1,
      }),
    });
    expect(r.checks[0]!.state).toBe('fail');
    expect(r.actions).toMatchObject({ state: 'partial', total: 4, pinned: 3, unpinned: 1 });
  });
  it('0 unpinned + 1 unreadable file → unknown', () =>
    expect(check({ workflows: read([wf('ci.yml', `a/x@${D}`)], { unreadable: 1 }) })).toBe(
      'unknown',
    ));
  it('0 unpinned + 1 invalid ref → unknown', () =>
    expect(check({ workflows: read([wf('ci.yml', `a/x@${D}`, '${{ matrix.x }}')]) })).toBe(
      'unknown',
    ));
  it('workflows none → not-applicable', () =>
    expect(check({ workflows: { state: 'none' } })).toBe('not-applicable'));
  it('only local refs → not-applicable', () =>
    expect(check({ workflows: read([wf('ci.yml', './.github/actions/lint')]) })).toBe(
      'not-applicable',
    ));
  it('not-authorised listing → unknown', () => {
    const r = repo({ workflows: { state: 'not-authorised' } });
    expect(r.checks[0]!.state).toBe('unknown');
    expect(r.actions).toMatchObject({ state: 'not-authorised', total: null, workflowFiles: null });
  });
  it("exemptActionOwners ['actions'] makes actions/checkout@v4 count as pinned → pass", () => {
    const exempt = policies((p) => {
      p.repositoryControls.exemptActionOwners = ['actions'];
    });
    const workflows = read([wf('ci.yml', 'actions/checkout@v4')]);
    expect(check({ workflows }, exempt)).toBe('pass');
    expect(check({ workflows })).toBe('fail');
  });
  it('capped → unknown when nothing unpinned, counts null', () => {
    const r = repo({ workflows: read([wf('ci.yml', `a/x@${D}`)], { capped: true }) });
    expect(r.checks[0]!.state).toBe('unknown');
    expect(r.actions).toMatchObject({ total: null, pinned: null, unpinned: null, unknown: null });
  });
  it('docker without digest is unpinned, with a digest pinned', () => {
    const r = repo({
      workflows: read([
        wf('ci.yml', 'docker://alpine:3.20', `docker://alpine@sha256:${'a'.repeat(64)}`),
      ]),
    });
    expect(r.actions).toMatchObject({ total: 2, pinned: 1, unpinned: 1 });
    expect(r.actions.unpinnedRefs).toEqual([
      { workflow: 'ci.yml', kind: 'docker', target: 'docker://alpine', ref: '3.20' },
    ]);
  });
});

describe('reusable-workflows-current', () => {
  const check = (ref: string, reusable?: Map<string, TargetVersions>) =>
    states({
      workflows: read([wf('rel.yml', reusableRef(ref))]),
      ...(reusable ? { reusable } : {}),
    })['reusable-workflows-current'];
  it('ref A with tags → pass', () => expect(check(A)).toBe('pass'));
  it('v2.1.0 → fail', () => expect(check('v2.1.0')).toBe('fail'));
  it('main → unknown', () => expect(check('main')).toBe('unknown'));
  it('invisible target → unknown', () =>
    expect(
      check(
        'v2.4.0',
        new Map([['example-shared/ci-templates', { latest: null, tags: null, visible: false }]]),
      ),
    ).toBe('unknown'));
  it('target missing from the map → unknown, url null', () => {
    const r = repo({
      workflows: read([wf('rel.yml', reusableRef('v1.0.0'))]),
      reusable: new Map(),
    });
    expect(r.checks[1]!.state).toBe('unknown');
    expect(r.reusableWorkflows[0]).toMatchObject({ status: 'unknown', url: null, latest: null });
  });
  it('no reusable refs → not-applicable', () =>
    expect(states({})['reusable-workflows-current']).toBe('not-applicable'));
  it('lists the reference with the referenced repository url', () => {
    const r = repo({ workflows: read([wf('rel.yml', reusableRef('v2.1.0'))]) });
    expect(r.reusableWorkflows).toEqual([
      {
        workflow: 'rel.yml',
        target: 'example-shared/ci-templates/.github/workflows/build.yml',
        ref: 'v2.1.0',
        latest: 'v2.4.0',
        status: 'behind',
        url: 'https://github.com/example-shared/ci-templates',
      },
    ]);
  });
});

describe('branch checks', () => {
  const branchStates = (s: Record<RepositoryCheckId, RepositoryCheckState>) => [
    s['branch-protected'],
    s['pull-request-required'],
    s['force-push-blocked'],
    s['status-checks-required'],
  ];
  it('rules [pull_request(2), required_status_checks, non_fast_forward, deletion], protected true → 4 × pass', () => {
    const r = repo({});
    expect(branchStates(Object.fromEntries(r.checks.map((c) => [c.id, c.state])) as never)).toEqual(
      ['pass', 'pass', 'pass', 'pass'],
    );
    expect(r.branchRules).toMatchObject({
      state: 'available',
      branch: 'main',
      protected: true,
      source: 'rulesets',
      requiredApprovals: 2,
      classicRead: false,
      otherRules: 0,
    });
    expect(r.branchRules.ruleTypes).toEqual([
      'pull_request',
      'required_status_checks',
      'non_fast_forward',
      'deletion',
    ]);
  });
  it('rules [] + protected true + classic not read → protected pass, the other three unknown (D6)', () => {
    const r = repo({ rules: ok([]), protected: true });
    expect(branchStates(states({ rules: ok([]), protected: true }))).toEqual([
      'pass',
      'unknown',
      'unknown',
      'unknown',
    ]);
    expect(r.branchRules.source).toBe('classic');
  });
  it('rules [pull_request, required_status_checks] + protected true → force-push-blocked unknown', () => {
    expect(
      states({
        rules: ok([FOUR_RULES[0]!, FOUR_RULES[1]!]),
        protected: true,
      })['force-push-blocked'],
    ).toBe('unknown');
  });
  it('rules [] + protected false → 4 × fail; source none', () => {
    const r = repo({ rules: ok([]), protected: false });
    expect(branchStates(states({ rules: ok([]), protected: false }))).toEqual([
      'fail',
      'fail',
      'fail',
      'fail',
    ]);
    expect(r.branchRules.source).toBe('none');
  });
  it('rules 403 + protected false → 4 × unknown; branchRules.state not-authorised', () => {
    const rules = fail<never>({ classification: 'not-authorised', httpStatus: 403 });
    const r = repo({ rules: rules as never, protected: false });
    expect(r.branchRules.state).toBe('not-authorised');
    expect(branchStates(states({ rules: rules as never, protected: false }))).toEqual([
      'unknown',
      'unknown',
      'unknown',
      'unknown',
    ]);
  });
  it('rules 403 + protected true → branch-protected pass, others unknown', () => {
    const rules = fail<never>({ classification: 'not-authorised', httpStatus: 403 }) as never;
    expect(branchStates(states({ rules, protected: true }))).toEqual([
      'pass',
      'unknown',
      'unknown',
      'unknown',
    ]);
  });
  it('classic read {pullRequestReviews, no status checks, force push blocked} + rules [] + protected true', () => {
    const input = {
      rules: ok([]),
      protected: true,
      classic: ok({
        pullRequestReviews: true,
        requiredApprovals: 1,
        statusChecks: false,
        forcePushBlocked: true,
        deletionBlocked: false,
      }),
    };
    const r = repo(input);
    expect(branchStates(states(input))).toEqual(['pass', 'pass', 'pass', 'fail']);
    expect(r.branchRules).toMatchObject({
      classicRead: true,
      source: 'classic',
      requiredApprovals: 1,
    });
  });
  it('rules [] + protected true + classic read but 404 (ambiguous) → protected pass, the other three unknown, never fail', () => {
    const input = { rules: ok([]), protected: true, classic: ok(null) };
    expect(branchStates(states(input))).toEqual(['pass', 'unknown', 'unknown', 'unknown']);
    expect(repo(input).branchRules.source).toBe('unknown');
  });
  it('rules [] + protected false + classic read 404 → 4 × fail (no contradiction)', () =>
    expect(branchStates(states({ rules: ok([]), protected: false, classic: ok(null) }))).toEqual([
      'fail',
      'fail',
      'fail',
      'fail',
    ]));
  it('rules 403 + protected true → source unknown, never inferred classic', () => {
    const rules = fail<never>({ classification: 'not-authorised', httpStatus: 403 }) as never;
    expect(repo({ rules, protected: true }).branchRules.source).toBe('unknown');
  });
  it('rules and classic together → source both', () =>
    expect(
      repo({
        classic: ok({
          pullRequestReviews: true,
          requiredApprovals: null,
          statusChecks: true,
          forcePushBlocked: true,
          deletionBlocked: true,
        }),
      }).branchRules.source,
    ).toBe('both'));
  it('unlisted rule types are counted, never named', () => {
    const r = repo({
      rules: ok([
        { type: 'pull_request', requiredApprovals: 99 },
        { type: 'future_rule_type', requiredApprovals: null },
      ]),
    });
    expect(r.branchRules.ruleTypes).toEqual(['pull_request']);
    expect(r.branchRules.otherRules).toBe(1);
    expect(r.branchRules.requiredApprovals).toBe(10);
    expect(JSON.stringify(r)).not.toContain('future_rule_type');
  });
});

describe('repository level', () => {
  it('archived → 6 × not-applicable', () =>
    expect(Object.values(states({ archived: true }))).toEqual(Array(6).fill('not-applicable')));
  it('unavailable → 6 × unknown', () => {
    const r = repo({ available: false });
    expect(r.checks.map((c) => c.state)).toEqual(Array(6).fill('unknown'));
    expect(r.ratio).toBeNull();
    expect(r.branchRules.state).toBe('unknown');
  });
  it("notApplicable ['status-checks-required'] → that check not-applicable", () =>
    expect(states({ notApplicable: ['status-checks-required'] })['status-checks-required']).toBe(
      'not-applicable',
    ));
  it('keeps the check order and per-repository counts', () => {
    const r = repo({});
    expect(r.checks.map((c) => c.id)).toEqual(ids);
    expect(r).toMatchObject({ passed: 5, failed: 0, unknown: 0, notApplicable: 1, ratio: 100 });
  });
});

describe('withholding and bounds', () => {
  const unpinned = (n: number) =>
    wf('ci.yml', ...Array.from({ length: n }, (_, i) => `owner/action-${i}@v1`));
  it('publicDetails false → unpinnedRefs [] and detailsWithheld true, counts unchanged', () => {
    const r = repo({ workflows: read([unpinned(3)]), publicDetails: false });
    expect(r.actions).toMatchObject({
      detailsWithheld: true,
      unpinnedRefs: [],
      truncated: 0,
      total: 3,
      unpinned: 3,
    });
  });
  it('unpinnedRefs capped at 20, truncated = rest', () => {
    const r = repo({ workflows: read([unpinned(27)]) });
    expect(r.actions.unpinnedRefs).toHaveLength(20);
    expect(r.actions.truncated).toBe(7);
    expect(r.actions.unpinned).toBe(27);
  });
  it('reusable workflow targets are withheld together with the details', () => {
    const r = repo({
      workflows: read([wf('rel.yml', reusableRef('v2.1.0'))]),
      publicDetails: false,
    });
    expect(r.reusableWorkflows).toEqual([]);
    expect(r.checks[1]!.state).toBe('fail');
  });
});

describe('scorecard', () => {
  it('analysis + alerts → available, failing checks in alert order, others counted', () => {
    const r = repo({
      scorecardAnalysis: ok({ createdAt: '2026-01-13T00:00:00Z', toolName: 'Scorecard' }),
      scorecardAlerts: [
        { ruleId: 'TokenPermissionsID' },
        { ruleId: 'PinnedDependenciesID' },
        { ruleId: 'FooID' },
      ],
    });
    expect(r.scorecard).toEqual({
      state: 'available',
      lastAnalysisAt: '2026-01-13T00:00:00Z',
      openAlerts: 3,
      failingChecks: ['Token-Permissions', 'Pinned-Dependencies'],
      otherFailing: 1,
    });
  });
  it('analysis ok(null) → not-used, openAlerts 0 when alerts readable', () =>
    expect(repo({ scorecardAnalysis: ok(null) }).scorecard).toMatchObject({
      state: 'not-used',
      openAlerts: 0,
      lastAnalysisAt: null,
    }));
  it('alerts null → openAlerts null', () =>
    expect(repo({ scorecardAlerts: null }).scorecard.openAlerts).toBeNull());
  it('403 → not-authorised; other errors → unknown', () => {
    expect(
      repo({ scorecardAnalysis: fail({ classification: 'not-authorised' }) }).scorecard.state,
    ).toBe('not-authorised');
    expect(repo({ scorecardAnalysis: fail({ classification: 'error' }) }).scorecard.state).toBe(
      'unknown',
    );
  });
});

describe('evaluateRepositoryControls', () => {
  const failing = () => repo({ workflows: read([wf('ci.yml', 'actions/checkout@v4')]) });
  const passing = () => repo({});
  const enforce = (set: (p: Policies) => void) => policies(set);

  it('defaults (all info): a failing check yields an info reason and governance stays green', () => {
    const { health, reasons } = evaluateRepositoryControls([failing()], P, COLLECTED_AT);
    expect(reasons).toEqual([
      {
        code: 'repository-check-failed',
        level: 'info',
        params: { check: 'actions-pinned', repositories: 'example-org/svc', count: 1 },
      },
    ]);
    expect(health.perCheck.every((c) => c.level === 'info')).toBe(true);
    const repoInput = {
      repository: {
        fullName: 'example-org/svc',
        status: 'ok',
        archived: false,
        defaultBranch: 'main',
        configuredDefaultBranch: 'main',
      },
      componentId: 'coordinator',
      statusFile: 'ok',
      needsStatusFile: false,
    } as never;
    expect(evaluateGovernance([repoInput], [workflow()], P, reasons).status).toBe('green');
  });
  it('actions-pinned red + one failing repository → reason level red', () => {
    const p = enforce((x) => {
      x.repositoryControls.checks['actions-pinned'] = 'red';
    });
    const { reasons } = evaluateRepositoryControls([failing(), passing()], p, COLLECTED_AT);
    expect(reasons).toEqual([
      expect.objectContaining({ code: 'repository-check-failed', level: 'red' }),
    ]);
  });
  it('branch-protected amber + unknownEnforcedCheck amber + one unknown repository → unknown amber', () => {
    const p = enforce((x) => {
      x.repositoryControls.checks['branch-protected'] = 'amber';
      x.repositoryControls.unknownEnforcedCheck = 'amber';
    });
    const unknown = repo({ rules: fail({ classification: 'error' }) as never, protected: null });
    const { reasons } = evaluateRepositoryControls([unknown, passing()], p, COLLECTED_AT);
    expect(reasons).toContainEqual({
      code: 'repository-check-unknown',
      level: 'amber',
      params: { check: 'branch-protected', repositories: 'example-org/svc', count: 1 },
    });
  });
  it('informative check with unknowns → no repository-check-unknown reason', () => {
    const unknown = repo({ rules: fail({ classification: 'error' }) as never, protected: null });
    const { reasons } = evaluateRepositoryControls([unknown], P, COLLECTED_AT);
    expect(reasons.map((r) => r.code)).not.toContain('repository-check-unknown');
  });
  it('names at most 10 repositories then "+N"', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      evaluateRepositoryChecks(
        controlsInput({
          repository: `example-org/r${i}`,
          workflows: read([wf('ci.yml', 'actions/checkout@v4')]),
        }),
        P,
      ),
    );
    const { reasons } = evaluateRepositoryControls(many, P, COLLECTED_AT);
    expect(String(reasons[0]!.params.repositories)).toMatch(/r9 \+2$/);
    expect(reasons[0]!.params.count).toBe(12);
  });
  it('ratio: passed 5 failed 7 → 42; passed 0 failed 0 → null', () => {
    const r = (passed: number, failed: number) => ({
      ...repo({}),
      checks: ids.map((id, i) => ({
        id,
        state: (i < passed ? 'pass' : i < passed + failed ? 'fail' : 'unknown') as never,
      })),
    });
    const five = Array.from({ length: 5 }, () => r(1, 0));
    const seven = Array.from({ length: 7 }, () => r(0, 1));
    expect(evaluateRepositoryControls([...five, ...seven], P, COLLECTED_AT).health).toMatchObject({
      passed: 5,
      failed: 7,
      ratio: 42,
    });
    expect(
      evaluateRepositoryControls([repo({ available: false })], P, COLLECTED_AT).health,
    ).toMatchObject({ passed: 0, failed: 0, ratio: null, unknown: 6 });
  });
  it('everything passing → repository-checks-passed (info)', () => {
    const { reasons } = evaluateRepositoryControls([passing()], P, COLLECTED_AT);
    expect(reasons).toEqual([{ code: 'repository-checks-passed', level: 'info', params: {} }]);
  });
  it('enabled false → empty health, no reasons', () => {
    const off = enforce((x) => {
      x.repositoryControls.enabled = false;
    });
    const { health, reasons } = evaluateRepositoryControls([failing()], off, COLLECTED_AT);
    expect(reasons).toEqual([]);
    expect(health).toMatchObject({
      enabled: false,
      repositories: [],
      passed: 0,
      failed: 0,
      unknown: 0,
      notApplicable: 0,
      ratio: null,
    });
    expect(health.perCheck).toHaveLength(6);
  });
});
