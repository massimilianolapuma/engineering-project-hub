import type {
  HealthStatus,
  Policies,
  QualityHealth,
  Reason,
  ReasonCode,
  ReasonLevel,
} from '@model/index';
import type { RepoQuality, RepoQualityState, SonarQuality } from '../normalizers/quality';
import type { CodeQualityFindingDTO, ProviderResult } from '../providers/types';
import { reason } from './health';

export type QualitySource = 'ci-summary' | 'sonarqube';

export interface QualityInput {
  /**
   * Coordinator first. `applicable` comes from isCoverageApplicable; `sonarKey` is the mapped
   * SonarQube project (null or absent: none).
   */
  components: {
    componentId: string;
    repository: string;
    applicable: boolean;
    sonarKey?: string | null;
  }[];
  /** CI summaries, key = repository.toLowerCase(). */
  ciReports: Map<string, RepoQuality>;
  /** SonarQube reports, key = Sonar project key. Absent key = SonarQube off. */
  sonarReports?: Map<string, SonarQuality>;
  /** Report sources in order of precedence. */
  sources?: readonly QualitySource[];
  /** Code Quality open findings, key = repository.toLowerCase(). */
  findings: Map<string, ProviderResult<CodeQualityFindingDTO[]>>;
  collectedAt: string;
}

export interface ReportCandidate {
  key: string;
  source: QualitySource;
  report: RepoQuality;
}

/** Order in which a failure to read decides what a component shows, most informative first. */
const FAILURE_ORDER: RepoQualityState[] = ['not-authorised', 'invalid', 'expired', 'unknown'];

/**
 * Spec 5.7: the first readable candidate in `sources` order; else the first stale; else the
 * first candidate by failure state (not-authorised, invalid, expired, unknown); else missing.
 * Sources not listed are ignored. null when there is no candidate.
 */
export function selectReport(
  candidates: ReportCandidate[],
  sources: readonly QualitySource[],
): ReportCandidate | null {
  const ordered = sources.flatMap((s) => candidates.filter((c) => c.source === s));
  if (!ordered.length) return null;
  for (const state of ['readable', 'stale', ...FAILURE_ORDER] as RepoQualityState[]) {
    const hit = ordered.find((c) => c.report.state === state);
    if (hit) return hit;
  }
  return ordered[0]!;
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
  selected: ReportCandidate | null,
  sonar: SonarQuality | undefined,
  sharedRepository: boolean,
): ComponentRow {
  const repo = selected?.report;
  const gateReadable = sonar && isMeasured(sonar.state);
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
    source: null,
    qualityGate: null,
    newCoverage: null,
  };
  if (!c.applicable) return { ...empty, state: 'not-applicable' };
  if (!repo || !selected) return { ...empty, state: 'unknown' };
  // The gate and the new-code coverage come from Sonar whenever it is readable, whoever
  // supplied the coverage.
  const sonarFields = {
    qualityGate: gateReadable ? sonar.qualityGate : null,
    newCoverage: gateReadable ? sonar.newCoverage : null,
  };
  // lines.valid 0 = no testable code: not applicable, not 0%.
  if (isMeasured(repo.state) && repo.linesValid === 0) return { ...empty, state: 'not-applicable' };
  if (!isMeasured(repo.state))
    return { ...empty, ...sonarFields, state: repo.state, source: selected.source };
  return {
    ...empty,
    ...sonarFields,
    source: selected.source,
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
  const sources = input.sources ?? ['ci-summary', 'sonarqube'];
  const sonarReports = input.sonarReports ?? new Map<string, SonarQuality>();

  // One selected report per applicable component; its key identifies the report to count once.
  const selections = input.components.map((c): ReportCandidate | null => {
    if (!c.applicable) return null;
    const candidates: ReportCandidate[] = [];
    const ci = input.ciReports.get(key(c.repository));
    if (ci) candidates.push({ key: `repo:${key(c.repository)}`, source: 'ci-summary', report: ci });
    const sonar = c.sonarKey ? sonarReports.get(c.sonarKey) : undefined;
    if (c.sonarKey && sonar)
      candidates.push({ key: `sonar:${c.sonarKey}`, source: 'sonarqube', report: sonar });
    return selectReport(candidates, sources);
  });
  const usage = new Map<string, number>();
  for (const sel of selections) if (sel) usage.set(sel.key, (usage.get(sel.key) ?? 0) + 1);

  const perComponent = input.components.map((c, i) => {
    const sel = selections[i]!;
    return componentRow(
      c,
      sel,
      c.sonarKey ? sonarReports.get(c.sonarKey) : undefined,
      sel !== null && (usage.get(sel.key) ?? 0) > 1,
    );
  });
  const applicableRows = perComponent.filter((r) => r.state !== 'not-applicable');
  const measuredRows = applicableRows.filter((r) => isMeasured(r.state));
  const staleRows = applicableRows.filter((r) => r.state === 'stale');
  const hiddenRows = applicableRows.filter((r) => !isMeasured(r.state));

  // Each selected report counted once (monorepos, coordinator shared with components).
  const counted = new Set<string>();
  let linesCovered = 0;
  let linesValid = 0;
  input.components.forEach((_, i) => {
    const sel = selections[i];
    if (!sel || !isMeasured(perComponent[i]!.state) || counted.has(sel.key)) return;
    counted.add(sel.key);
    linesCovered += perComponent[i]!.linesCovered ?? 0;
    linesValid += perComponent[i]!.linesValid ?? 0;
  });
  const percentage = percent(linesCovered, linesValid);

  const failedGateRows = perComponent.filter((r) => r.qualityGate === 'failed');
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
    const gateCap = q.qualityGateFailed === 'amber' && failedGateRows.length > 0;
    const capped =
      staleRows.length > 0 || (q.missingReportIsAmber && hiddenRows.length > 0) || gateCap;
    if (capped && status === 'green') status = 'amber';
  }

  if (staleRows.length)
    reasons.push(reason('quality-report-stale', 'amber', { components: ids(staleRows) }));
  if (failedGateRows.length)
    reasons.push(
      reason('quality-gate-failed', q.qualityGateFailed, { components: ids(failedGateRows) }),
    );
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
    findings: evaluateFindings([...new Set(input.components.map((c) => key(c.repository)))], input),
  };
}
