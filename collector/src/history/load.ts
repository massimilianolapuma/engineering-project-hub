import { open } from 'node:fs/promises';
import { join } from 'node:path';
import {
  HistoryFileSchema,
  HistoryProbeSchema,
  SUPPORTED_HISTORY_SCHEMA_VERSIONS,
  type Catalog,
  type DataSource,
  type HistoryBaseline,
  type HistoryFile,
  type Policies,
} from '@model/index';
import { sanitizeUrl, scrubIdentifier } from '../sanitizers/sanitize';
import { resolveRelativeTime } from '../util/clock';

/** A parsed, cleaned history; baseline is null when the last entry was dropped by cleaning. */
export type CleanHistory = Omit<HistoryFile, 'baseline'> & { baseline: HistoryBaseline | null };
export type PreviousHistory =
  | { state: 'restored' | 'fixture'; file: CleanHistory }
  | {
      state: 'none' | 'restore-failed' | 'unreadable' | 'incompatible' | 'source-changed';
      file: null;
    };

export const HISTORY_MAX_BYTES = 8_388_608;

export interface LoadHistoryOptions {
  dataSource: DataSource;
  /** Directory containing history.json. Never applies to the mock source. */
  historyFrom: string;
  /** Used only when dataSource is "mock". Never applies to github. */
  fixturePath: string;
  /** $HISTORY_RESTORE_STATE: 'restored' | 'none' | 'failed' | undefined. */
  restoreState?: string | undefined;
  /** --fresh-history */
  fresh?: boolean | undefined;
  catalog: Catalog;
  policies: Policies;
  now: Date;
}

/** Same tokens as the mock provider fixtures. */
const TOKEN_IN_TEXT = /@now(?:[+-]\d+[mhd])?/g;

type ReadResult = { ok: true; text: string } | { ok: false; reason: 'missing' | 'unreadable' };

/** One handle: the size check and the read see the same file (no check-then-use race). */
async function readBounded(path: string): Promise<ReadResult> {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
    return { ok: false, reason: missing ? 'missing' : 'unreadable' };
  }
  try {
    const { size } = await handle.stat();
    if (size > HISTORY_MAX_BYTES) return { ok: false, reason: 'unreadable' };
    const buf = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buf, 0, size, 0);
    return { ok: true, text: buf.subarray(0, bytesRead).toString('utf8') };
  } catch {
    return { ok: false, reason: 'unreadable' };
  } finally {
    await handle.close();
  }
}

type FreshState = Exclude<PreviousHistory['state'], 'restored' | 'fixture'>;
const freshStart = <S extends FreshState>(state: S): { state: S; file: null } => ({
  state,
  file: null,
});

/**
 * Previous history for this run. The file is untrusted input: bounded read, strict parse,
 * re-sanitised links and identifiers. A fresh state never fails the collection.
 */
export async function loadPreviousHistory(o: LoadHistoryOptions): Promise<PreviousHistory> {
  if (o.dataSource === 'mock') {
    const read = await readBounded(o.fixturePath);
    if (!read.ok) return freshStart(read.reason === 'missing' ? 'none' : 'unreadable');
    const text = read.text.replace(TOKEN_IN_TEXT, (t) => resolveRelativeTime(t, o.now) ?? t);
    const parsed = parseHistory(text);
    if (parsed.state !== 'ok') return freshStart(parsed.state);
    const file = cleanHistory(parsed.file, o.catalog, o.policies, o.now);
    return file.entries.length ? { state: 'fixture', file } : freshStart('none');
  }
  if (o.fresh) return freshStart('none');
  if (o.restoreState === 'failed') return freshStart('restore-failed');
  if (o.restoreState === 'none') return freshStart('none');
  const read = await readBounded(join(o.historyFrom, 'history.json'));
  if (!read.ok) return freshStart(read.reason === 'missing' ? 'none' : 'unreadable');
  const parsed = parseHistory(read.text);
  if (parsed.state !== 'ok') return freshStart(parsed.state);
  if (parsed.file.entries.at(-1)?.dataSource !== o.dataSource) return freshStart('source-changed');
  const file = cleanHistory(parsed.file, o.catalog, o.policies, o.now);
  return file.entries.length ? { state: 'restored', file } : freshStart('none');
}

function parseHistory(
  text: string,
): { state: 'ok'; file: HistoryFile } | { state: 'unreadable' | 'incompatible' } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { state: 'unreadable' };
  }
  const probe = HistoryProbeSchema.safeParse(json);
  if (!probe.success || probe.data.kind !== 'hub-history') return { state: 'unreadable' };
  if (!(SUPPORTED_HISTORY_SCHEMA_VERSIONS as readonly string[]).includes(probe.data.schemaVersion))
    return { state: 'incompatible' };
  const full = HistoryFileSchema.safeParse(json);
  return full.success ? { state: 'ok', file: full.data } : { state: 'unreadable' };
}

/**
 * Drops what must not be reused: entries at or after now, duplicates, projects no longer in
 * the catalog (a removed project does not linger), and re-sanitises the baseline. When the
 * last entry is dropped the baseline no longer describes it and becomes null.
 */
export function cleanHistory(
  file: HistoryFile,
  catalog: Catalog,
  policies: Policies,
  now: Date,
): CleanHistory {
  const ids = new Set(catalog.projects.map((p) => p.id));
  const byTime = new Map<number, HistoryFile['entries'][number]>();
  for (const e of file.entries) {
    const t = Date.parse(e.collectedAt);
    if (t < now.getTime()) byTime.set(t, e);
  }
  const entries = [...byTime.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, e]) => ({ ...e, projects: e.projects.filter((p) => ids.has(p.id)) }))
    .filter((e) => e.projects.length > 0);
  const last = entries.at(-1);
  const baselineMatches =
    last !== undefined && Date.parse(file.baseline.collectedAt) === Date.parse(last.collectedAt);
  return {
    ...file,
    entries,
    baseline: baselineMatches ? cleanBaseline(file.baseline, ids, policies) : null,
  };
}

function cleanBaseline(
  baseline: HistoryBaseline,
  ids: ReadonlySet<string>,
  policies: Policies,
): HistoryBaseline {
  const hosts = policies.publication.allowedLinkHosts;
  return {
    collectedAt: baseline.collectedAt,
    projects: baseline.projects
      .filter((p) => ids.has(p.id))
      .map((p) => ({
        ...p,
        findings: p.findings.flatMap((f) => {
          const id = scrubIdentifier(f.id, 200);
          return id ? [{ ...f, id, htmlUrl: sanitizeUrl(f.htmlUrl, hosts) }] : [];
        }),
        versions: p.versions.map((v) => ({ ...v, version: scrubIdentifier(v.version, 100) })),
      })),
  };
}
