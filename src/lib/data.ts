import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CatalogSnapshot, PortfolioIndex, ProjectSnapshot } from '@model/index';
import {
  validateCatalogSnapshot,
  validatePortfolio,
  validateProject,
  type DataError,
  type Loaded,
} from './validate';

/*
 * Build-time snapshot loading. The browser never calls GitHub: pages are rendered from
 * these validated JSON files. SNAPSHOT_DIR overrides the default location (tests).
 */
const dataDir = () => resolve(process.env.SNAPSHOT_DIR ?? 'public/data');

function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export interface SiteData {
  index: PortfolioIndex;
  projects: ProjectSnapshot[];
}

let cache: { dir: string; result: Loaded<SiteData> } | null = null;

/** Loads and validates everything once per build; returns a typed error instead of throwing. */
export function loadSiteData(): Loaded<SiteData> {
  const dir = dataDir();
  if (cache?.dir === dir) return cache.result;
  const result = load(dir);
  cache = { dir, result };
  if (!result.ok)
    console.warn(
      `[engineering-project-hub] snapshot data unavailable (${result.error.kind}): ${result.error.message}`,
    );
  return result;
}

function load(dir: string): Loaded<SiteData> {
  const missing: DataError = { kind: 'missing', message: `no snapshot found in ${dir}` };
  const indexText = readText(join(dir, 'index.json'));
  if (indexText === null) return { ok: false, error: missing };
  const index = validatePortfolio(indexText);
  if (!index.ok) return index;
  let files: string[];
  try {
    files = readdirSync(join(dir, 'projects')).filter((f) => f.endsWith('.json'));
  } catch {
    return { ok: false, error: missing };
  }
  const projects: ProjectSnapshot[] = [];
  for (const p of index.data.projects) {
    if (!files.includes(`${p.id}.json`))
      return { ok: false, error: { kind: 'missing', message: `missing projects/${p.id}.json` } };
    const res = validateProject(readText(join(dir, 'projects', `${p.id}.json`)) ?? '');
    if (!res.ok) return res;
    projects.push(res.data);
  }
  return { ok: true, data: { index: index.data, projects } };
}

let catalogCache: { dir: string; result: Loaded<CatalogSnapshot> } | null = null;

/** Catalog published by the collector (catalog.json): the site never reads config/*.yaml. */
export function loadCatalogSnapshot(): Loaded<CatalogSnapshot> {
  const dir = dataDir();
  if (catalogCache?.dir === dir) return catalogCache.result;
  const text = readText(join(dir, 'catalog.json'));
  const result: Loaded<CatalogSnapshot> =
    text === null
      ? { ok: false, error: { kind: 'missing', message: `no catalog.json found in ${dir}` } }
      : validateCatalogSnapshot(text);
  catalogCache = { dir, result };
  if (!result.ok)
    console.warn(
      `[engineering-project-hub] catalog snapshot unavailable (${result.error.kind}): ${result.error.message}`,
    );
  return result;
}
