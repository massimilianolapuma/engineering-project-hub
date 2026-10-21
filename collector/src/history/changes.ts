import {
  CHANGES_SCHEMA_VERSION,
  DimensionSchema,
  type ChangesFile,
  type HealthStatus,
  type PortfolioIndex,
  type ProjectSnapshot,
} from '@model/index';
import {
  BASELINE_LIST_CAP,
  dimensionsOf,
  errorKey,
  FINDING_PAIR_SOURCE,
  monitoredRepositories,
  openCriticalHigh,
  pairKey,
  unreadablePairs,
} from './baseline';
import type { PreviousHistory } from './load';

type ProjectChanges = ChangesFile['projects'][number];

const LIST_CAP = 50;

const compareFindings = (
  a: { id: string; severity: 'critical' | 'high' },
  b: { id: string; severity: 'critical' | 'high' },
): number =>
  Number(a.severity === 'high') - Number(b.severity === 'high') || a.id.localeCompare(b.id);

/**
 * What moved since the previous collection. Pure. A fresh history (anything but "restored" or
 * "fixture") yields a basis other than "compared" with empty lists: the page must show the
 * basis, never "no changes". Alerts are compared per (repository, source) pair and only when
 * that pair was readable in both runs, so an unreadable source never fakes "resolved" or "new".
 */
export function computeChanges(
  previous: PreviousHistory,
  index: PortfolioIndex,
  projects: ProjectSnapshot[],
): ChangesFile {
  const snapshots = new Map(projects.map((p) => [p.project.id, p]));
  const last = previous.file?.entries.at(-1);
  const file = previous.file;
  if (!file || !last) {
    const state =
      previous.state === 'restored' || previous.state === 'fixture' ? 'none' : previous.state;
    return {
      kind: 'hub-changes',
      schemaVersion: CHANGES_SCHEMA_VERSION,
      generatedAt: index.generatedAt,
      basis: { state, previousCollectedAt: null, synthetic: false },
      totals: {
        statusChanges: 0,
        newFindings: 0,
        resolvedFindings: 0,
        versionMoves: 0,
        newErrors: 0,
      },
      projects: index.projects.map((s) =>
        emptyProject(s.id, s.overall, s.score.value, false, null),
      ),
    };
  }

  const totals = {
    statusChanges: 0,
    newFindings: 0,
    resolvedFindings: 0,
    versionMoves: 0,
    newErrors: 0,
  };
  const out: ProjectChanges[] = [];
  for (const s of index.projects) {
    const point = last.projects.find((p) => p.id === s.id);
    if (!point) {
      out.push(emptyProject(s.id, s.overall, s.score.value, true, null));
      continue;
    }
    const entry = emptyProject(s.id, s.overall, s.score.value, false, {
      overall: point.overall,
      score: point.score,
    });
    const current = dimensionsOf(s);
    const compare = (
      dimension: 'overall' | (typeof DimensionSchema.options)[number],
      from: HealthStatus | undefined,
      to: HealthStatus,
    ) => {
      if (from !== undefined && from !== to) entry.statusChanges.push({ dimension, from, to });
    };
    compare('overall', point.overall, s.overall);
    for (const d of DimensionSchema.options) compare(d, point.dimensions[d], current[d]);

    const before = file.baseline?.projects.find((p) => p.id === s.id);
    const snapshot = snapshots.get(s.id);
    if (!before || !snapshot) {
      // No baseline for this project (dropped by cleaning): statuses only.
      entry.findingsPartial = true;
    } else {
      const alerts = diffAlerts(entry, before, snapshot);
      totals.newFindings += alerts.new;
      totals.resolvedFindings += alerts.resolved;
      diffVersions(entry, before, snapshot);
      diffErrors(entry, before, snapshot);
    }
    totals.statusChanges += entry.statusChanges.length;
    totals.versionMoves += entry.versionMoves.length;
    totals.newErrors += entry.newErrors.length;
    out.push(entry);
  }
  return {
    kind: 'hub-changes',
    schemaVersion: CHANGES_SCHEMA_VERSION,
    generatedAt: index.generatedAt,
    basis: {
      state: 'compared',
      previousCollectedAt: last.collectedAt,
      synthetic: previous.state === 'fixture',
    },
    totals,
    projects: out,
  };
}

type Baseline = NonNullable<NonNullable<PreviousHistory['file']>['baseline']>['projects'][number];

function emptyProject(
  id: string,
  overall: HealthStatus,
  score: number | null,
  added: boolean,
  previous: ProjectChanges['previous'],
): ProjectChanges {
  return {
    id,
    added,
    previous,
    current: { overall, score },
    statusChanges: [],
    newFindings: [],
    resolvedFindings: [],
    findingsTruncated: 0,
    findingsPartial: false,
    versionMoves: [],
    newErrors: [],
    resolvedErrors: 0,
  };
}

/** Fills the alert lists; returns the full (untruncated) counts for the totals. */
function diffAlerts(
  entry: ProjectChanges,
  before: Baseline,
  snapshot: ProjectSnapshot,
): { new: number; resolved: number } {
  const nowUnreadable = new Set(unreadablePairs(snapshot.collectionErrors));
  const wasUnreadable = new Set(before.unreadable);
  // A repository monitored in only one of the two runs (catalog change) is not compared.
  const nowMonitored = new Set(monitoredRepositories(snapshot));
  const wasMonitored = new Set(before.repositories);
  const catalogChanged =
    nowMonitored.size !== wasMonitored.size || [...nowMonitored].some((r) => !wasMonitored.has(r));
  // A previous list at its cap may have been cut: an alert missing from it may have been open
  // (or unreadable) then, so nothing is reported as new. "Resolved" stays exact.
  const wasCut =
    before.findings.length >= BASELINE_LIST_CAP ||
    before.unreadable.length >= BASELINE_LIST_CAP ||
    before.repositories.length >= BASELINE_LIST_CAP;
  const current = openCriticalHigh(snapshot);
  const wasIds = new Set(before.findings.map((f) => f.id));
  const nowIds = new Set(current.map((f) => f.id));

  const fresh = (wasCut ? [] : current)
    .filter(
      (f) =>
        !wasIds.has(f.id) &&
        wasMonitored.has(f.repository) &&
        !wasUnreadable.has(pairKey(f.repository, FINDING_PAIR_SOURCE[f.source])),
    )
    .map((f) => ({
      id: f.id,
      severity: f.severity,
      componentId: f.componentId,
      repository: f.repository,
      title: f.title,
      htmlUrl: f.htmlUrl,
    }));
  const resolved = before.findings
    .filter(
      (f) =>
        !nowIds.has(f.id) &&
        nowMonitored.has(f.repository) &&
        !nowUnreadable.has(pairKey(f.repository, FINDING_PAIR_SOURCE[f.source])),
    )
    .map((f) => ({
      id: f.id,
      severity: f.severity,
      componentId: f.componentId,
      repository: f.repository,
      htmlUrl: f.htmlUrl,
    }))
    .sort(compareFindings);

  entry.newFindings = fresh.slice(0, LIST_CAP);
  entry.resolvedFindings = resolved.slice(0, LIST_CAP);
  entry.findingsTruncated =
    Math.max(0, fresh.length - LIST_CAP) + Math.max(0, resolved.length - LIST_CAP);
  entry.findingsPartial =
    nowUnreadable.size > 0 || wasUnreadable.size > 0 || catalogChanged || wasCut;
  return { new: fresh.length, resolved: resolved.length };
}

/** Only when both values are known and differ; known to unknown is a visibility loss. */
function diffVersions(entry: ProjectChanges, before: Baseline, snapshot: ProjectSnapshot): void {
  const now = [
    { kind: 'coordinator' as const, componentId: null, version: snapshot.coordinator.version },
    ...snapshot.components.map((c) => ({
      kind: 'component' as const,
      componentId: c.id,
      version: c.effectiveVersion,
    })),
  ];
  for (const v of now) {
    const was = before.versions.find((b) => b.kind === v.kind && b.componentId === v.componentId);
    if (was?.version && v.version && was.version !== v.version)
      entry.versionMoves.push({
        kind: v.kind,
        componentId: v.componentId,
        from: was.version,
        to: v.version,
      });
  }
}

/** A previous error list at its cap may have been cut: no error is then listed as new. */
function diffErrors(entry: ProjectChanges, before: Baseline, snapshot: ProjectSnapshot): void {
  const was = new Set(before.errors);
  const wasCut = before.errors.length >= BASELINE_LIST_CAP;
  const seen = new Map<string, ProjectSnapshot['collectionErrors'][number]>();
  for (const e of snapshot.collectionErrors) seen.set(errorKey(e), e);
  entry.newErrors = (wasCut ? [] : [...seen.entries()])
    .filter(([key]) => !was.has(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, e]) => ({
      repository: e.repository,
      source: e.source,
      classification: e.classification,
    }));
  entry.resolvedErrors = [...was].filter((key) => !seen.has(key)).length;
}
