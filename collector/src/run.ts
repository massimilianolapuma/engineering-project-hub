import { readFileSync } from 'node:fs';
import {
  CapabilitySchema,
  SNAPSHOT_SCHEMA_VERSION,
  type Availability,
  type Capability,
  type Catalog,
  type CollectionError,
  type Policies,
  type PortfolioIndex,
  type ProjectSnapshot,
  type RunMetadata,
} from '@model/index';
import { buildProjectSnapshot, toProjectSummary } from './build-snapshot';
import { collectProject, type CollectContext, type RawProjectData } from './collectors/collect';
import type { ProviderResult, SourceProvider } from './providers/types';
import { createLimiter } from './util/concurrency';
import type { Clock } from './util/clock';

const COLLECTOR_VERSION: string = (() => {
  try {
    return (
      JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
        version: string;
      }
    ).version;
  } catch {
    return '0.0.0';
  }
})();

export interface RunOptions {
  catalog: Catalog;
  policies: Policies;
  provider: SourceProvider;
  clock: Clock;
  concurrency?: number;
}

export interface RunResult {
  index: PortfolioIndex;
  projects: ProjectSnapshot[];
}

/** Aggregates per-call outcomes into one availability value per capability. */
function capabilities(raws: RawProjectData[]): Record<Capability, Availability> {
  const outcomes: Record<Capability, ProviderResult<unknown>[]> = Object.fromEntries(
    CapabilitySchema.options.map((c) => [c, []]),
  ) as unknown as Record<Capability, ProviderResult<unknown>[]>;
  for (const raw of raws) {
    for (const r of raw.repos) {
      outcomes.metadata.push(r.repo);
      if (!r.repo.ok) continue;
      outcomes.contents.push(r.securityStatusFile);
      outcomes.codeScanning.push(r.codeScanning);
      outcomes.dependabot.push(r.dependabot);
      outcomes.secretScanning.push(r.secretScanning);
    }
    outcomes.contents.push(raw.manifest, raw.gitmodules);
    for (const w of raw.workflows) outcomes.actions.push(w.runs);
  }
  // Calls skipped because the repository was not accessible say nothing about permissions.
  for (const cap of CapabilitySchema.options) {
    outcomes[cap] = outcomes[cap].filter((r) => r.ok || !r.error.skipped);
  }
  // A 404 / "not configured" still proves the permission works.
  const usable = (r: ProviderResult<unknown>) =>
    r.ok || r.error.classification === 'not-found' || r.error.classification === 'not-configured';
  const denied = (r: ProviderResult<unknown>) =>
    !r.ok && r.error.classification === 'not-authorised';
  const result = {} as Record<Capability, Availability>;
  for (const cap of CapabilitySchema.options) {
    const list = outcomes[cap];
    if (!list.length) result[cap] = 'not-used';
    else if (list.every(usable)) result[cap] = 'available';
    else if (!list.some(usable)) result[cap] = list.some(denied) ? 'not-authorised' : 'unknown';
    else result[cap] = 'partial';
  }
  return result;
}

export async function runCollection(opts: RunOptions): Promise<RunResult> {
  const { catalog, policies, provider, clock } = opts;
  const startedAt = clock();
  const ctx: CollectContext = {
    provider,
    limit: createLimiter(opts.concurrency ?? 4),
    cache: new Map(),
  };

  // One project failing unexpectedly must not stop the others.
  const raws = await Promise.all(catalog.projects.map((p) => collectProject(ctx, p)));
  const now = clock();
  const projects = raws.map((raw) => buildProjectSnapshot(raw, policies, now));
  const finishedAt = clock();

  const allRepos = new Map<string, { metadataOk: boolean; errors: number }>();
  for (const raw of raws) {
    for (const r of raw.repos) {
      const entry = allRepos.get(r.repository) ?? { metadataOk: r.repo.ok, errors: 0 };
      allRepos.set(r.repository, entry);
    }
  }
  const uniqueErrors = new Map<string, CollectionError>();
  for (const p of projects) {
    for (const e of p.collectionErrors)
      uniqueErrors.set(`${e.repository}|${e.source}|${e.classification}`, e);
  }
  for (const e of uniqueErrors.values()) {
    const entry = allRepos.get(e.repository);
    if (entry) entry.errors++;
  }
  const repoValues = [...allRepos.values()];
  const run: RunMetadata = {
    dataSource: provider.dataSource,
    authenticationMode: provider.authenticationMode,
    collectorVersion: COLLECTOR_VERSION,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    capabilities: capabilities(raws),
    inaccessibleSources: [...uniqueErrors.values()]
      .filter(
        (e) =>
          e.classification === 'not-authorised' ||
          (e.classification === 'not-found' && e.source === 'repository'),
      )
      .map((e) => ({
        repository: e.repository,
        source: e.source,
        classification: e.classification,
      })),
    repositories: {
      total: repoValues.length,
      ok: repoValues.filter((r) => r.metadataOk && r.errors === 0).length,
      withErrors: repoValues.filter((r) => r.metadataOk && r.errors > 0).length,
      unavailable: repoValues.filter((r) => !r.metadataOk).length,
    },
    configValid: true,
    policy: {
      snapshotStaleHours: policies.freshness.snapshotStaleHours,
      audience: policies.publication.audience,
    },
  };
  const index: PortfolioIndex = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    run,
    projects: projects.map(toProjectSummary),
  };
  return { index, projects };
}
