import type {
  HealthStatus,
  Policies,
  QualityHealth,
  Reason,
  ReasonCode,
  ReasonLevel,
} from '@model/index';
import type { RepoQuality, RepoQualityState } from '../normalizers/quality';
import type { CodeQualityFindingDTO, ProviderResult } from '../providers/types';
import { reason } from './health';

export interface QualityInput {
  /** Coordinator first. `applicable` comes from isCoverageApplicable. */
  components: { componentId: string; repository: string; applicable: boolean }[];
  /** Key = repository.toLowerCase(). */
  repos: Map<string, RepoQuality>;
  /** Code Quality open findings, key = repository.toLowerCase(). */
  findings: Map<string, ProviderResult<CodeQualityFindingDTO[]>>;
  collectedAt: string;
}

type ComponentRow = QualityHealth['perComponent'][number];
type Findings = QualityHealth['findings'];

const NOT_VISIBLE_REASON: Record<Exclude<RepoQualityState, 'readable' | 'stale'>, ReasonCode> = {
  missing: 'quality-report-missing',
  expired: 'quality-report-expired',
  invalid: 'quality-report-invalid',
  'not-authorised': 'quality-report-not-authorised',
  unknown: 'quality-report-unknown',
};

const isMeasured = (s: ComponentRow['state']) => s === 'readable' || s === 'stale';

/** One decimal; null when there is nothing testable (never 0% and never NaN). */
const percent = (covered: number, valid: number) =>
  valid > 0 ? Math.round((covered / valid) * 1000) / 10 : null;

function componentRow(
  c: QualityInput['components'][number],
  repo: RepoQuality | undefined,
  sharedRepository: boolean,
): ComponentRow {
  const empty = {
    componentId: c.componentId,
    sharedRepository,
    percentage: null,
    linesCovered: null,
    linesValid: null,
    commitSha: null,
    generatedAt: null,
    tool: null,
    runUrl: null,
  };
  if (!c.applicable) return { ...empty, state: 'not-applicable' };
  if (!repo) return { ...empty, state: 'unknown' };
  // lines.valid 0 = no testable code: not applicable, not 0%.
  if (isMeasured(repo.state) && repo.linesValid === 0) return { ...empty, state: 'not-applicable' };
  if (!isMeasured(repo.state)) return { ...empty, state: repo.state };
  return {
    ...empty,
    state: repo.state,
    percentage: percent(repo.linesCovered ?? 0, repo.linesValid ?? 0),
    linesCovered: repo.linesCovered,
    linesValid: repo.linesValid,
    commitSha: repo.commitSha,
    generatedAt: repo.generatedAt,
    tool: repo.tool,
    runUrl: repo.runUrl,
  };
}

const unknownFindings = (state: Findings['state']): Findings => ({
  state,
  reliability: null,
  maintainability: null,
  bySeverity: { error: null, warning: null, note: null, none: null },
});

/**
 * Code Quality findings, counted once per repository. A repository whose error message says
 * Code Quality is not enabled is skipped; a 403 is not-authorised; a 404 or any other failure
 * is unknown (the setup endpoint needs Administration: write, so it is never called). Counts
 * are published only when every repository was readable or skipped: a partial sum would read
 * as a total.
 */
function evaluateFindings(repositories: string[], input: QualityInput): Findings {
  let notAuthorised = false;
  let unreadable = false;
  const lists: CodeQualityFindingDTO[][] = [];
  for (const key of repositories) {
    const findings = input.findings.get(key);
    if (findings?.ok) lists.push(findings.data);
    else if (findings && findings.error.classification === 'not-configured') continue;
    else {
      unreadable = true;
      if (findings?.error.classification === 'not-authorised') notAuthorised = true;
    }
  }
  if (unreadable) return unknownFindings(notAuthorised ? 'not-authorised' : 'unknown');
  if (!lists.length) return unknownFindings('not-configured');
  const all = lists.flat();
  const count = (pred: (f: CodeQualityFindingDTO) => boolean) => all.filter(pred).length;
  const severity = (f: CodeQualityFindingDTO) => f.severity.trim().toLowerCase();
  const known = new Set(['error', 'warning', 'note']);
  return {
    state: 'available',
    reliability: count((f) => f.category.trim().toLowerCase() === 'reliability'),
    maintainability: count((f) => f.category.trim().toLowerCase() === 'maintainability'),
    bySeverity: {
      error: count((f) => severity(f) === 'error'),
      warning: count((f) => severity(f) === 'warning'),
      note: count((f) => severity(f) === 'note'),
      // "none" and any severity GitHub may add later.
      none: count((f) => !known.has(severity(f))),
    },
  };
}

/**
 * Quality (test coverage) health, spec §5.4. Project coverage = Σ covered / Σ valid over the
 * unique repositories whose report is readable or stale; not-visible components never count.
 * A stale report, or (missingReportIsAmber) a not-visible applicable component, caps the
 * status at amber; the cap never upgrades a red.
 */
export function evaluateQuality(input: QualityInput, policies: Policies): QualityHealth {
  const q = policies.quality;
  const key = (repository: string) => repository.toLowerCase();
  const usage = new Map<string, number>();
  for (const c of input.components)
    usage.set(key(c.repository), (usage.get(key(c.repository)) ?? 0) + 1);

  const perComponent = input.components.map((c) =>
    componentRow(c, input.repos.get(key(c.repository)), (usage.get(key(c.repository)) ?? 0) > 1),
  );
  const applicableRows = perComponent.filter((r) => r.state !== 'not-applicable');
  const measuredRows = applicableRows.filter((r) => isMeasured(r.state));
  const staleRows = applicableRows.filter((r) => r.state === 'stale');
  const hiddenRows = applicableRows.filter((r) => !isMeasured(r.state));

  // Each repository counted once (monorepos, coordinator shared with components).
  const counted = new Set<string>();
  let linesCovered = 0;
  let linesValid = 0;
  input.components.forEach((c, i) => {
    const k = key(c.repository);
    if (!isMeasured(perComponent[i]!.state) || counted.has(k)) return;
    counted.add(k);
    linesCovered += perComponent[i]!.linesCovered ?? 0;
    linesValid += perComponent[i]!.linesValid ?? 0;
  });
  const percentage = percent(linesCovered, linesValid);

  const ids = (rows: ComponentRow[]) => rows.map((r) => r.componentId).join(', ');
  const reasons: Reason[] = [];
  let status: HealthStatus;
  if (!applicableRows.length) {
    status = 'grey';
    reasons.push(reason('quality-not-applicable', 'info', { components: ids(perComponent) }));
  } else if (percentage === null) {
    status = 'grey';
  } else {
    const below = (threshold: number) =>
      measuredRows.filter((r) => (r.percentage ?? 0) < threshold);
    if (percentage < q.amberThresholdPercent) {
      status = 'red';
      reasons.push(
        reason('quality-below-red-threshold', 'red', {
          components: ids(below(q.amberThresholdPercent)),
          percentage,
          threshold: q.amberThresholdPercent,
        }),
      );
    } else if (percentage < q.greenThresholdPercent) {
      status = 'amber';
      reasons.push(
        reason('quality-below-threshold', 'amber', {
          components: ids(below(q.greenThresholdPercent)),
          percentage,
          threshold: q.greenThresholdPercent,
        }),
      );
    } else status = 'green';
    const capped = staleRows.length > 0 || (q.missingReportIsAmber && hiddenRows.length > 0);
    if (capped && status === 'green') status = 'amber';
  }

  if (staleRows.length)
    reasons.push(reason('quality-report-stale', 'amber', { components: ids(staleRows) }));
  // A grey Quality already says "nothing visible": its reasons stay informative and never
  // add amber rows to the why box. Otherwise a not-visible component caps at amber.
  const hiddenLevel: ReasonLevel = status === 'grey' || !q.missingReportIsAmber ? 'info' : 'amber';
  for (const [state, code] of Object.entries(NOT_VISIBLE_REASON)) {
    const rows = hiddenRows.filter((r) => r.state === state);
    if (rows.length) reasons.push(reason(code, hiddenLevel, { components: ids(rows) }));
  }
  if (status === 'green')
    reasons.push(
      reason('quality-all-above-threshold', 'info', {
        components: ids(measuredRows),
        percentage: percentage ?? 0,
      }),
    );

  return {
    status,
    reasons,
    percentage,
    linesCovered,
    linesValid,
    measured: measuredRows.length,
    applicable: applicableRows.length,
    notVisible: hiddenRows.length,
    stale: staleRows.length,
    collectedAt: input.collectedAt,
    perComponent,
    findings: evaluateFindings([...usage.keys()], input),
  };
}
