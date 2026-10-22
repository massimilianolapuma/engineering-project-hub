import {
  countsAsOpen,
  type ControlStatus,
  type HistoryFile,
  type ProjectSnapshot,
  type ProjectSummary,
  type SeverityCounts,
} from '@model/index';
import { NA, toCsv, type CsvValue } from './csv';
import type { SiteData } from './data';

/*
 * Rows of the three CSV exports, built from the same validated data the pages use.
 * No titles, rule ids, paths or links: only statuses, counts, versions and ids.
 */
/**
 * The CSV published when the snapshot data is missing or invalid. A header-only file would
 * read as "zero projects"; one row that says so is unmistakable (unknown is never 0).
 */
export const unavailableCsv = (headers: readonly string[]): string =>
  toCsv(headers, [['data unavailable', ...headers.slice(1).map(() => null)]]);

export const PORTFOLIO_HEADERS: readonly string[] = [
  'project_id',
  'project_name',
  'business_unit',
  'lifecycle',
  'overall',
  'score',
  'score_measured',
  'score_required',
  'delivery',
  'version',
  'security',
  'controls_coverage',
  'controls_coverage_percent',
  'governance',
  'quality',
  'quality_percent',
  'open_critical',
  'open_high',
  'open_medium',
  'open_low',
  'counts_complete',
  'open_secret_alerts',
  'failed_critical_workflows',
  'collection_errors',
  'collected_at',
  'previous_overall',
  'previous_score',
  'previous_collected_at',
  'controls_passed',
  'controls_failed',
  'controls_unknown',
  // Risk governance (v0.9.0), appended so existing positions stay stable.
  'overdue',
  'overdue_critical_high',
  'accepted',
  'exception_issues',
];

export const FINDINGS_HEADERS: readonly string[] = [
  'project_id',
  'component_id',
  'repository',
  'open_critical',
  'open_high',
  'open_medium',
  'open_low',
  'open_informational',
  'open_unknown',
  'sources_complete',
  'overdue',
  'accepted',
];

export const VERSIONS_HEADERS: readonly string[] = [
  'row_type',
  'project_id',
  'item_id',
  'item_name',
  'repository',
  'version',
  'version_source',
  'declared_version',
  'latest_release',
  'drift',
  'manifest_consistency',
  'pin_status',
  'environment_status',
];

/** The security dimension of a summary is the health status of the security view. */
const securityOf = (s: ProjectSummary): CsvValue => s.security;

/** Repository check counts; n/a when the checks are off (nothing was evaluated), never 0. */
function controlCounts(s: ProjectSummary): CsvValue[] {
  const c = s.repositoryControls;
  const evaluated = c.passed + c.failed + c.unknown > 0;
  return evaluated ? [c.passed, c.failed, c.unknown] : [NA, NA, NA];
}

export function portfolioRows(data: SiteData, history: HistoryFile | null): CsvValue[][] {
  const previous = history?.entries.at(-2) ?? null;
  return data.index.projects.map((s) => {
    const before = previous?.projects.find((p) => p.id === s.id) ?? null;
    return [
      s.id,
      s.name,
      s.businessUnit,
      s.lifecycle,
      s.overall,
      s.score.value,
      s.score.measured,
      s.score.required,
      s.delivery,
      s.version,
      securityOf(s),
      s.coverage.status,
      s.coverage.percentage,
      s.governance,
      s.quality.status,
      s.quality.percentage,
      s.openCounts.critical,
      s.openCounts.high,
      s.openCounts.medium,
      s.openCounts.low,
      s.countsComplete,
      s.openSecretAlerts,
      s.failedCriticalWorkflows,
      s.collectionErrorCount,
      s.collectedAt,
      before ? before.overall : NA,
      before ? before.score : NA,
      before && previous ? previous.collectedAt : NA,
      ...controlCounts(s),
      s.risk.overdue,
      s.risk.overdueCriticalHigh,
      s.risk.accepted,
      s.risk.exceptionIssues,
    ];
  });
}

/** The three native alert controls; their counts are the repository's open alerts. */
const ALERT_CONTROLS: ReadonlySet<ControlStatus['control']> = new Set([
  'codeScanning',
  'secretScanning',
  'dependabot',
]);
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational', 'unknown'] as const;

/**
 * Counts of one repository. null for a severity when no alert source was readable; a lower
 * bound (sourcesComplete false) when only some were.
 */
function repositoryCounts(controls: readonly ControlStatus[]): {
  counts: SeverityCounts;
  complete: boolean;
} {
  const alert = controls.filter((c) => ALERT_CONTROLS.has(c.control));
  const counts = Object.fromEntries(
    SEVERITIES.map((k) => {
      const read = alert.filter((c) => c.counts !== null);
      return [k, read.length ? read.reduce((n, c) => n + (c.counts?.[k] ?? 0), 0) : null];
    }),
  ) as SeverityCounts;
  const complete = alert.every((c) => c.counts !== null || c.state === 'not-configured');
  return { counts, complete };
}

export function findingsRows(data: SiteData): CsvValue[][] {
  return data.projects.flatMap((p) =>
    p.securityControls.map((rc) => {
      const { counts, complete } = repositoryCounts(rc.controls);
      // Overdue needs SLAs on and a readable alert source; unknown is never 0.
      const measured = p.securityHealth.remediation.enabled && counts.critical !== null;
      const own = p.securityFindings.filter((f) => f.repository === rc.repository);
      const overdue = own.filter((f) => countsAsOpen(f) && f.sla?.state === 'overdue').length;
      const accepted = own.filter(
        (f) => f.status === 'open' && f.exception?.state === 'active',
      ).length;
      return [
        p.project.id,
        rc.componentId,
        rc.repository,
        counts.critical,
        counts.high,
        counts.medium,
        counts.low,
        counts.informational,
        counts.unknown,
        complete,
        measured ? overdue : null,
        counts.critical !== null ? accepted : null,
      ];
    }),
  );
}

function projectVersionRows(p: ProjectSnapshot): CsvValue[][] {
  const id = p.project.id;
  const c = p.coordinator;
  const rows: CsvValue[][] = [
    [
      'coordinator',
      id,
      'coordinator',
      p.project.name,
      c.repository.fullName,
      c.version,
      c.versionSource,
      NA,
      c.latestRelease?.tag ?? null,
      NA,
      NA,
      NA,
      NA,
    ],
  ];
  for (const k of p.components)
    rows.push([
      'component',
      id,
      k.id,
      k.name,
      k.repository.fullName,
      k.effectiveVersion,
      k.effectiveVersionSource,
      k.declaredVersion,
      k.latestRelease?.tag ?? null,
      k.drift,
      k.manifestConsistency,
      k.pin?.status ?? null,
      NA,
    ]);
  for (const e of p.environments)
    rows.push([
      'environment',
      id,
      e.id,
      e.name,
      NA,
      e.version,
      e.source,
      NA,
      NA,
      NA,
      NA,
      NA,
      e.status,
    ]);
  return rows;
}

export const versionsRows = (data: SiteData): CsvValue[][] =>
  data.projects.flatMap(projectVersionRows);
