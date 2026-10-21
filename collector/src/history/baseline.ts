import {
  type CollectionError,
  type Dimension,
  type FindingSource,
  type HealthStatus,
  type HistoryBaseline,
  type PortfolioIndex,
  type ProjectSnapshot,
  type ProjectSummary,
  type SecurityFinding,
} from '@model/index';

type PairSource = CollectionError['source'];

/** Alert sources whose (repository, source) pair is tracked as readable or not. */
const ALERT_PAIR_SOURCES = [
  'code-scanning',
  'dependabot',
  'secret-scanning',
  'security-status-file',
] as const satisfies readonly PairSource[];

/** Finding source → the collection error source that explains why its alerts are missing. */
export const FINDING_PAIR_SOURCE: Record<FindingSource, PairSource> = {
  'github-code-scanning': 'code-scanning',
  'github-dependabot': 'dependabot',
  'github-secret-scanning': 'secret-scanning',
  'security-status-file': 'security-status-file',
};

/**
 * Each baseline list keeps at most this many items. A list at the cap may have been cut, so
 * the next diff must not treat a missing item as "not there before" (see changes.ts).
 */
export const BASELINE_LIST_CAP = 500;
/** Versions per project (coordinator first). A version beyond it is simply not compared. */
export const BASELINE_VERSIONS_CAP = 200;

export const pairKey = (repository: string, source: PairSource): string =>
  `${repository}|${source}`;
export const errorKey = (e: CollectionError): string =>
  `${e.repository}|${e.source}|${e.classification}`;

/** Health status of each dimension of a project summary, in the same keys as the history. */
export function dimensionsOf(s: ProjectSummary): Record<Dimension, HealthStatus> {
  return {
    delivery: s.delivery,
    version: s.version,
    security: s.security,
    coverage: s.coverage.status,
    governance: s.governance,
    quality: s.quality.status,
  };
}

type CriticalOrHigh = SecurityFinding & { severity: 'critical' | 'high' };

/** Open critical/high alerts, critical first, then by id. */
export function openCriticalHigh(p: ProjectSnapshot): CriticalOrHigh[] {
  const out: CriticalOrHigh[] = [];
  for (const f of p.securityFindings)
    if (f.status === 'open' && (f.severity === 'critical' || f.severity === 'high'))
      out.push({ ...f, severity: f.severity });
  return out.sort(
    (a, b) =>
      Number(a.severity === 'high') - Number(b.severity === 'high') || a.id.localeCompare(b.id),
  );
}

/** Repositories whose alerts this run collected (one security-controls row each), sorted. */
export function monitoredRepositories(p: ProjectSnapshot): string[] {
  return [...new Set(p.securityControls.map((c) => c.repository))].sort();
}

/**
 * (repository, source) pairs whose alerts could not be read. A repository error makes all four
 * pairs of that repository unreadable.
 */
export function unreadablePairs(errors: readonly CollectionError[]): string[] {
  const pairs = new Set<string>();
  for (const e of errors) {
    if (e.source === 'repository')
      for (const s of ALERT_PAIR_SOURCES) pairs.add(pairKey(e.repository, s));
    else if ((ALERT_PAIR_SOURCES as readonly PairSource[]).includes(e.source))
      pairs.add(pairKey(e.repository, e.source));
  }
  return [...pairs].sort();
}

/** The small state the next run needs to diff against: built from the run's snapshots. */
export function buildBaseline(index: PortfolioIndex, projects: ProjectSnapshot[]): HistoryBaseline {
  return {
    collectedAt: index.generatedAt,
    projects: projects.map((p) => ({
      id: p.project.id,
      repositories: monitoredRepositories(p).slice(0, BASELINE_LIST_CAP),
      findings: openCriticalHigh(p)
        .slice(0, BASELINE_LIST_CAP)
        .map((f) => ({
          id: f.id,
          severity: f.severity,
          componentId: f.componentId,
          repository: f.repository,
          source: f.source,
          htmlUrl: f.htmlUrl,
        })),
      unreadable: unreadablePairs(p.collectionErrors).slice(0, BASELINE_LIST_CAP),
      versions: [
        { kind: 'coordinator' as const, componentId: null, version: p.coordinator.version },
        ...p.components.map((c) => ({
          kind: 'component' as const,
          componentId: c.id,
          version: c.effectiveVersion,
        })),
      ].slice(0, BASELINE_VERSIONS_CAP),
      errors: [...new Set(p.collectionErrors.map(errorKey))].sort().slice(0, BASELINE_LIST_CAP),
    })),
  };
}
