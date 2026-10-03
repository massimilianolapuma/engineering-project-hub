import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CatalogSnapshotSchema,
  PortfolioIndexSchema,
  ProjectSnapshotSchema,
  type Catalog,
  type CatalogSnapshot,
  type CollectionError,
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
  };
}

export function serialise(
  index: PortfolioIndex,
  projects: ProjectSnapshot[],
  catalog?: Catalog,
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
    const parsed = CatalogSnapshotSchema.safeParse(buildCatalogSnapshot(catalog, index, projects));
    if (!parsed.success) {
      throw new SnapshotValidationError(
        'catalog.json does not match the schema:',
        formatIssues(parsed.error),
      );
    }
    files.set('catalog.json', `${JSON.stringify(parsed.data, null, 2)}\n`);
  }
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
}

export function buildReport(index: PortfolioIndex, projects: ProjectSnapshot[]): CollectionReport {
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
  };
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
    '',
    '### Projects',
    '',
    '| Project | Overall | Collection errors |',
    '|---|---|---|',
    ...r.projects.map((p) => `| ${p.id} | ${p.overall} | ${p.errors} |`),
    '',
  ];
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
): Promise<CollectionReport> {
  const files = serialise(index, projects, catalog);
  const report = buildReport(index, projects);
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
