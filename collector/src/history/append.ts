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
import { formatIssues } from '../config/load';
import { DAY_MS } from '../util/clock';
import { SnapshotValidationError } from '../writers/write-snapshots';
import { buildBaseline, dimensionsOf } from './baseline';
import { HISTORY_MAX_BYTES, type PreviousHistory } from './load';

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
  const parsed = HistoryFileSchema.safeParse({
    kind: 'hub-history',
    schemaVersion: HISTORY_SCHEMA_VERSION,
    generatedAt: index.generatedAt,
    retention: { maxEntries, maxAgeDays },
    restore: { state: previous.state, previousEntries: entries.length - 1 },
    entries,
    baseline: buildBaseline(index, projects),
  });
  if (!parsed.success)
    throw new SnapshotValidationError(
      'history.json does not match the history schema:',
      formatIssues(parsed.error),
    );
  return parsed.data;
}

const compactSize = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

/**
 * The next run reads at most HISTORY_MAX_BYTES: a larger file would be set aside as
 * "unreadable". Drops the oldest entries until the compact file (as written) fits; the current
 * entry always stays. `fits` is false when even the current entry alone is too large.
 */
export function fitHistory(
  file: HistoryFile,
  maxBytes: number = HISTORY_MAX_BYTES,
): { file: HistoryFile; dropped: number; fits: boolean } {
  // Serialised as JSON.stringify(file) plus a newline (see serialiseHistoryFiles).
  let size = compactSize(file) + 1;
  let dropped = 0;
  while (size > maxBytes && dropped < file.entries.length - 1) {
    size -= compactSize(file.entries[dropped]) + 1; // the entry and its comma
    dropped++;
  }
  if (dropped === 0) return { file, dropped, fits: size <= maxBytes };
  const entries = file.entries.slice(dropped);
  const fitted = {
    ...file,
    restore: { ...file.restore, previousEntries: entries.length - 1 },
    entries,
  };
  return { file: fitted, dropped, fits: compactSize(fitted) + 1 <= maxBytes };
}
