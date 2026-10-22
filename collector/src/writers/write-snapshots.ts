import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CatalogSnapshotSchema,
  ChangesFileSchema,
  HistoryFileSchema,
  PortfolioIndexSchema,
  ProjectSnapshotSchema,
  type Catalog,
  type CatalogSnapshot,
  type DiscoveryResult,
  type ChangesFile,
  type CollectionError,
  type HistoryFile,
  type HistoryRestoreState,
  type PortfolioIndex,
  type ProjectSnapshot,
} from '@model/index';
import { assertPublishable, SanitizationError } from '../sanitizers/sanitize';
import { formatIssues } from '../config/load';

export class SnapshotValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(`${message}\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'SnapshotValidationError';
  }
}

/**
 * Validates against the strict (allowlist) schemas, runs the sanitisation gate, then
 * serialises. Throws instead of writing anything that is not publishable.
 */
/** catalog.json for the catalog editor: validated catalog + suggestions from collected data. */
export function buildCatalogSnapshot(
  catalog: Catalog,
  index: PortfolioIndex,
  projects: ProjectSnapshot[],
  discovery: DiscoveryResult | null = null,
): CatalogSnapshot {
  return {
    schemaVersion: index.schemaVersion,
    generatedAt: index.generatedAt,
    catalog,
    suggestions: projects.map((p) => ({
      projectId: p.project.id,
      unmappedSubmodules: p.coordinator.submodules
        .filter((s) => s.association === 'unmapped')
        .map((s) => ({ path: s.path, repository: s.repository })),
    })),
    discovery,
  };
}

/** history.json and changes.json; null (or omitted) when history is turned off. */
export interface HistoryExtras {
  history: HistoryFile | null;
  changes: ChangesFile | null;
  /** Why the history was set aside, trimmed or not written (collection report). */
  notes?: string[];
}

/**
 * history.json and changes.json, validated against their strict schemas and passed through
 * the publication gate. Throws like serialise.
 */
export function serialiseHistoryFiles(extras: HistoryExtras): Map<string, string> {
  const files = new Map<string, string>();
  if (extras.history) {
    const parsed = HistoryFileSchema.safeParse(extras.history);
    if (!parsed.success) {
      throw new SnapshotValidationError(
        'history.json does not match the history schema:',
        formatIssues(parsed.error),
      );
    }
    // The only large file: compact, unlike the snapshots.
    files.set('history.json', `${JSON.stringify(parsed.data)}\n`);
  }
  if (extras.changes) {
    const parsed = ChangesFileSchema.safeParse(extras.changes);
    if (!parsed.success) {
      throw new SnapshotValidationError(
        'changes.json does not match the changes schema:',
        formatIssues(parsed.error),
      );
    }
    files.set('changes.json', `${JSON.stringify(parsed.data, null, 2)}\n`);
  }
  for (const [name, text] of files) assertPublishable(text, name);
  return files;
}

export function serialise(
  index: PortfolioIndex,
  projects: ProjectSnapshot[],
  catalog?: Catalog,
  discovery: DiscoveryResult | null = null,
  extras?: HistoryExtras,
): Map<string, string> {
  const files = new Map<string, string>();
  const idx = PortfolioIndexSchema.safeParse(index);
  if (!idx.success)
    throw new SnapshotValidationError(
      'index.json does not match the snapshot schema:',
      formatIssues(idx.error),
    );
  files.set('index.json', `${JSON.stringify(idx.data, null, 2)}\n`);
  for (const p of projects) {
    const parsed = ProjectSnapshotSchema.safeParse(p);
    if (!parsed.success) {
      throw new SnapshotValidationError(
        `projects/${p.project.id}.json does not match the snapshot schema:`,
        formatIssues(parsed.error),
      );
    }
    files.set(`projects/${p.project.id}.json`, `${JSON.stringify(parsed.data, null, 2)}\n`);
  }
  if (catalog) {
    const parsed = CatalogSnapshotSchema.safeParse(
      buildCatalogSnapshot(catalog, index, projects, discovery),
    );
    if (!parsed.success) {
      throw new SnapshotValidationError(
        'catalog.json does not match the schema:',
        formatIssues(parsed.error),
      );
    }
    files.set('catalog.json', `${JSON.stringify(parsed.data, null, 2)}\n`);
  }
  if (extras) for (const [name, text] of serialiseHistoryFiles(extras)) files.set(name, text);
  for (const [name, text] of files) assertPublishable(text, name);
  return files;
}

export interface CollectionReport {
  generatedAt: string;
  dataSource: string;
  authenticationMode: string;
  durationMs: number;
  projects: { id: string; overall: string; errors: number }[];
  repositories: PortfolioIndex['run']['repositories'];
  errorsByClassification: Record<string, number>;
  errors: CollectionError[];
  /** Exceptions by state, de-duplicated by id across projects (monorepos share them). */
  exceptions: {
    source: PortfolioIndex['run']['exceptions']['source'];
    total: number;
    active: number;
    expired: number;
    stale: number;
    unverifiable: number;
    invalid: number;
    orphaned: number;
  };
  /**
   * null when history is turned off. "not-written": the history could not be built this run
   * (see notes); the snapshots were still written.
   */
  history: {
    state: HistoryRestoreState | 'not-written';
    entries: number;
    notes: string[];
  } | null;
}

export function buildReport(
  index: PortfolioIndex,
  projects: ProjectSnapshot[],
  history: HistoryFile | null = null,
  notes: readonly string[] = [],
): CollectionReport {
  const seen = new Set<string>();
  const errors = projects
    .flatMap((p) => p.collectionErrors)
    .filter((e) => {
      const key = `${e.repository}|${e.source}|${e.classification}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const errorsByClassification: Record<string, number> = {};
  for (const e of errors)
    errorsByClassification[e.classification] = (errorsByClassification[e.classification] ?? 0) + 1;
  const states = new Map<string, string>();
  // An exception shared by two projects is counted once, in its worst state.
  const WORST = ['invalid', 'expired', 'unverifiable', 'stale', 'active'];
  for (const e of projects.flatMap((p) => p.securityExceptions)) {
    const seen = states.get(e.id);
    if (seen === undefined || WORST.indexOf(e.state) < WORST.indexOf(seen))
      states.set(e.id, e.state);
  }
  const inState = (s: string) => [...states.values()].filter((x) => x === s).length;
  return {
    generatedAt: index.generatedAt,
    dataSource: index.run.dataSource,
    authenticationMode: index.run.authenticationMode,
    durationMs: index.run.durationMs,
    projects: index.projects.map((p) => ({
      id: p.id,
      overall: p.overall,
      errors: p.collectionErrorCount,
    })),
    repositories: index.run.repositories,
    errorsByClassification,
    errors,
    exceptions: {
      source: index.run.exceptions.source,
      total: index.run.exceptions.total,
      active: inState('active'),
      expired: inState('expired'),
      stale: inState('stale'),
      unverifiable: inState('unverifiable'),
      invalid: inState('invalid'),
      orphaned: index.run.exceptions.orphaned.length,
    },
    history: history
      ? { state: history.restore.state, entries: history.entries.length, notes: [...notes] }
      : notes.length
        ? { state: 'not-written', entries: 0, notes: [...notes] }
        : null,
  };
}

function historyLine(h: CollectionReport['history']): string {
  if (!h) return 'disabled';
  if (h.state === 'not-written') return 'not written this run (see history notes)';
  const entries = `${h.entries} ${h.entries === 1 ? 'entry' : 'entries'}`;
  const usable = h.state === 'restored' || h.state === 'fixture';
  return `${usable ? h.state : `started fresh (${h.state})`} · ${entries}`;
}

function exceptionsLine(e: CollectionReport['exceptions']): string {
  if (e.source === 'none') return 'Exceptions: none';
  return `Exceptions: ${e.total} loaded (${e.source}) · ${e.active} active · ${e.expired} expired · ${e.stale} stale · ${e.unverifiable} unverifiable${e.invalid > 0 ? ` · ${e.invalid} invalid` : ''} · ${e.orphaned} orphaned`;
}

export function reportMarkdown(r: CollectionReport): string {
  const lines = [
    '## Engineering Project Hub — collection report',
    '',
    `| Field | Value |`,
    `|---|---|`,
    `| Generated at | ${r.generatedAt} |`,
    `| Data source | ${r.dataSource} |`,
    `| Authentication | ${r.authenticationMode} |`,
    `| Duration | ${r.durationMs} ms |`,
    `| Repositories | ${r.repositories.total} total · ${r.repositories.ok} ok · ${r.repositories.withErrors} with errors · ${r.repositories.unavailable} unavailable |`,
    `| History | ${historyLine(r.history)} |`,
    '',
    exceptionsLine(r.exceptions),
    '',
    '### Projects',
    '',
    '| Project | Overall | Collection errors |',
    '|---|---|---|',
    ...r.projects.map((p) => `| ${p.id} | ${p.overall} | ${p.errors} |`),
    '',
  ];
  if (r.history?.notes.length)
    lines.push('### History notes', '', ...r.history.notes.map((n) => `- ${n}`), '');
  if (r.errors.length) {
    lines.push(
      '### Collection errors',
      '',
      '| Repository | Source | Classification | HTTP |',
      '|---|---|---|---|',
    );
    for (const e of r.errors)
      lines.push(`| ${e.repository} | ${e.source} | ${e.classification} | ${e.httpStatus ?? ''} |`);
    lines.push('');
  } else lines.push('No collection errors.', '');
  return lines.join('\n');
}

export async function writeSnapshots(
  outDir: string,
  index: PortfolioIndex,
  projects: ProjectSnapshot[],
  catalog?: Catalog,
  discovery: DiscoveryResult | null = null,
  extras?: HistoryExtras,
): Promise<CollectionReport> {
  const files = serialise(index, projects, catalog, discovery, extras);
  const report = buildReport(index, projects, extras?.history ?? null, extras?.notes ?? []);
  const reportJson = `${JSON.stringify(report, null, 2)}\n`;
  const reportMd = reportMarkdown(report);
  assertPublishable(reportJson, 'collection-report.json');
  assertPublishable(reportMd, 'collection-report.md');
  // Remove previous output so deleted projects do not linger.
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, 'projects'), { recursive: true });
  for (const [name, text] of files) await writeFile(join(outDir, name), text, 'utf8');
  await writeFile(join(outDir, 'collection-report.json'), reportJson, 'utf8');
  await writeFile(join(outDir, 'collection-report.md'), reportMd, 'utf8');
  return report;
}

export { SanitizationError };
