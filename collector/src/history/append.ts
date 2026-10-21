import {
  HISTORY_SCHEMA_VERSION,
  HistoryFileSchema,
  type Catalog,
  type HistoryEntry,
  type HistoryFile,
  type PortfolioIndex,
  type Policies,
  type ProjectSnapshot,
} from '@model/index';
import { DAY_MS } from '../util/clock';
import { buildBaseline, dimensionsOf } from './baseline';
import type { PreviousHistory } from './load';

/** One history entry from the run's per-project summaries. Nothing else is kept per run. */
export function entryFromRun(index: PortfolioIndex): HistoryEntry {
  return {
    collectedAt: index.generatedAt,
    dataSource: index.run.dataSource,
    authenticationMode: index.run.authenticationMode,
    collectorVersion: index.run.collectorVersion,
    projects: index.projects.map((s) => ({
      id: s.id,
      overall: s.overall,
      score: s.score.value,
      scoreMeasured: s.score.measured,
      scoreRequired: s.score.required,
      dimensions: dimensionsOf(s),
      open: {
        critical: s.openCounts.critical,
        high: s.openCounts.high,
        medium: s.openCounts.medium,
        low: s.openCounts.low,
      },
      countsComplete: s.countsComplete,
      collectionErrors: s.collectionErrorCount,
    })),
  };
}

/**
 * Previous entries (when usable) plus the current run, trimmed by age then by count. The
 * current entry always survives (maxEntries is at least 2).
 */
export function appendHistory(
  previous: PreviousHistory,
  index: PortfolioIndex,
  projects: ProjectSnapshot[],
  catalog: Catalog,
  policies: Policies,
  now: Date,
): HistoryFile {
  const { maxEntries, maxAgeDays } = policies.history;
  const current = entryFromRun(index);
  const currentAt = Date.parse(current.collectedAt);
  const oldest = now.getTime() - maxAgeDays * DAY_MS;
  const ids = new Set(catalog.projects.map((p) => p.id));
  const kept = (previous.file?.entries ?? [])
    .map((e) => ({ ...e, projects: e.projects.filter((p) => ids.has(p.id)) }))
    .filter((e) => {
      const t = Date.parse(e.collectedAt);
      return e.projects.length > 0 && t >= oldest && t < currentAt;
    });
  const entries = [...kept, current].slice(-maxEntries);
  return HistoryFileSchema.parse({
    kind: 'hub-history',
    schemaVersion: HISTORY_SCHEMA_VERSION,
    generatedAt: index.generatedAt,
    retention: { maxEntries, maxAgeDays },
    restore: { state: previous.state, previousEntries: entries.length - 1 },
    entries,
    baseline: buildBaseline(index, projects),
  });
}
