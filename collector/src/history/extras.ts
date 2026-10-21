import type { Catalog, PortfolioIndex, Policies, ProjectSnapshot } from '@model/index';
import { SanitizationError } from '../sanitizers/sanitize';
import {
  serialiseHistoryFiles,
  SnapshotValidationError,
  type HistoryExtras,
} from '../writers/write-snapshots';
import { appendHistory } from './append';
import { computeChanges } from './changes';
import type { PreviousHistory } from './load';

/** One line for the report: the reason, never the offending value. */
export function describeHistoryError(e: unknown): string {
  if (e instanceof SnapshotValidationError)
    return `${e.message.split('\n')[0]} ${e.issues.slice(0, 3).join('; ')}`.slice(0, 300);
  if (e instanceof SanitizationError) return e.message.slice(0, 300);
  const err = e as Error | undefined;
  return `${err?.name ?? 'Error'}: ${String(err?.message ?? '').split('\n')[0]}`.slice(0, 300);
}

/**
 * history.json and changes.json for this run, already validated and gated. History must never
 * block the snapshots: when a restored history cannot be used it is set aside and the run
 * starts fresh ("unreadable"); when even a fresh history cannot be built, neither file is
 * written. Each fallback adds a note to the collection report.
 */
export function buildHistoryExtras(
  previous: PreviousHistory,
  index: PortfolioIndex,
  projects: ProjectSnapshot[],
  catalog: Catalog,
  policies: Policies,
  now: Date,
): HistoryExtras {
  const notes: string[] = [];
  const attempt = (p: PreviousHistory): HistoryExtras => {
    const extras: HistoryExtras = {
      history: appendHistory(p, index, projects, catalog, policies, now),
      changes: computeChanges(p, index, projects),
    };
    serialiseHistoryFiles(extras);
    return { ...extras, notes };
  };
  let basis = previous;
  if (basis.file) {
    try {
      return attempt(basis);
    } catch (e) {
      notes.push(
        `The restored history could not be used and was set aside; history starts fresh (${describeHistoryError(e)}).`,
      );
      basis = { state: 'unreadable', file: null };
    }
  }
  try {
    return attempt(basis);
  } catch (e) {
    notes.push(`History and changes were not written for this run (${describeHistoryError(e)}).`);
    return { history: null, changes: null, notes };
  }
}
