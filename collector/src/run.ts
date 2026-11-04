import { readFileSync } from 'node:fs';
import {
  CapabilitySchema,
  SNAPSHOT_SCHEMA_VERSION,
  type Availability,
  type Capability,
  type Catalog,
  type CollectionError,
  type DiscoveryResult,
  type TeamsResult,
  PROVIDER_IDS,
  PROVIDERS_OFF,
  type Policies,
  type PortfolioIndex,
  type ProjectSnapshot,
  type ProvidersFile,
  type RunMetadata,
  type RunProviders,
} from '@model/index';
import { buildProjectSnapshot, toProjectSummary } from './build-snapshot';
import { collectControlMap, controlMapPublished } from './collectors/collect-control-map';
import type { LoadedExceptions } from './config/load';
import { orphanedExceptionIds } from './policy/exceptions';
import { discover } from './discovery/discover';
import { discoverTeams } from './discovery/teams';
import { collectExternal, type ExternalUsage } from './collectors/collect-external';
import { effectiveVersions } from './normalizers/containers';
import type { ProviderAuth } from './providers/external/auth';
import type { ExternalProviders } from './providers/external/types';
import {
  collectCoordinatorTags,
  collectProject,
  collectReusableTargets,
  type CollectContext,
  type RawProjectData,
} from './collectors/collect';
import { referencedRepositories } from './normalizers/repository-controls-model';
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
  /** Loaded exceptions (default: none). */
  exceptions?: LoadedExceptions;
  /** providers.yaml (default: everything off). Only `enabled` and `maxItems` are read here. */
  providers?: ProvidersFile;
  /** Providers that are on (null = off). Default: none, so no external host is contacted. */
  external?: ExternalProviders;
  /** Credential state: an enabled provider without a credential reads as not-authorised. */
  providerAuth?: ProviderAuth;
  /** Waits between SBOM export polls. Default: a real timer, or none for the mock source. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RunResult {
  index: PortfolioIndex;
  projects: ProjectSnapshot[];
  /** Discovery proposals (null when discovery is disabled). */
  discovery: DiscoveryResult | null;
  /** Team suggestions (null when team discovery is off or the audience is public). */
  teams: TeamsResult | null;
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
      outcomes.codeQuality.push(r.codeQualityFindings);
      outcomes.dependencyGraph.push(...(r.sbomRequest ? [r.sbomRequest] : []));
      if (r.attestations !== 'skipped') outcomes.attestations.push(...r.attestations.values());
      if (r.controls) {
        // Metadata: read only. Opt-in classic protection needs Administration: read, a separate
        // permission: its failures are recorded as errors, not as this capability.
        outcomes.repositoryRules.push(r.controls.rules);
        outcomes.contents.push(r.controls.workflowDir, ...r.controls.workflowFiles.values());
        outcomes.codeScanning.push(r.controls.scorecardAnalysis);
      }
    }
    outcomes.contents.push(raw.manifest, raw.gitmodules);
    for (const w of raw.workflows) outcomes.actions.push(w.runs);
  }
  // Calls skipped because the repository was not accessible say nothing about permissions.
  for (const cap of CapabilitySchema.options) {
    outcomes[cap] = outcomes[cap].filter((r) => r.ok || !r.error.skipped);
  }
  // A 404 / "not configured" / page-cap hit still proves the permission works.
  const usable = (r: ProviderResult<unknown>) =>
    r.ok ||
    r.error.incomplete === true ||
    r.error.classification === 'not-found' ||
    r.error.classification === 'not-configured';
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

/** Run-level state of each provider, with the usable / denied rules of the capabilities. */
function runProviders(
  providers: ProvidersFile,
  usage: ExternalUsage,
  auth: ProviderAuth | undefined,
): RunProviders {
  const usable = (r: ProviderResult<unknown>) =>
    r.ok || r.error.classification === 'not-found' || r.error.classification === 'not-configured';
  return Object.fromEntries(
    PROVIDER_IDS.map((id) => {
      if (!providers[id].enabled)
        return [id, { enabled: false, state: 'off' as const, items: 0, errors: 0 }];
      const { results, items, errors } = usage[id];
      const state =
        auth && auth[id].authHeader === null
          ? ('not-authorised' as const)
          : results.every(usable)
            ? ('available' as const)
            : !results.some(usable)
              ? results.some((r) => !r.ok && r.error.classification === 'not-authorised')
                ? ('not-authorised' as const)
                : ('unknown' as const)
              : ('partial' as const);
      return [id, { enabled: true, state, items, errors }];
    }),
  ) as RunProviders;
}

export async function runCollection(opts: RunOptions): Promise<RunResult> {
  const { catalog, policies, provider, clock } = opts;
  const startedAt = clock();
  const ctx: CollectContext = {
    provider,
    limit: createLimiter(opts.concurrency ?? 4),
    cache: new Map(),
    policies,
    // The mock source answers at once: waiting for a report that will not change is pointless.
    sleep: opts.sleep ?? (provider.dataSource === 'mock' ? async () => {} : undefined),
  };

  // One project failing unexpectedly must not stop the others.
  const raws = await Promise.all(catalog.projects.map((p) => collectProject(ctx, p)));
  const { teams, discovery } = await discoverTeams(
    ctx,
    catalog,
    policies,
    await discover(ctx, catalog, policies),
  );
  const now = clock();
  // Optional external providers: only the ones that are on are contacted.
  const providers = opts.providers ?? PROVIDERS_OFF;
  const external = opts.external ?? { sonarqube: null, harbor: null, argocd: null };
  if (external.argocd) await collectCoordinatorTags(ctx, raws);
  const usage = await collectExternal(
    external,
    providers,
    raws,
    new Map(raws.map((raw) => [raw.config.id, effectiveVersions(raw, policies, now)])),
    ctx.cache,
  );
  // Reusable workflows: latest release / tag of the referenced repositories, once per run.
  const referenced = referencedRepositories(raws.flatMap((raw) => raw.repos));
  const reusable = await collectReusableTargets(ctx, referenced.targets, referenced.shaTargets);
  const exceptions = opts.exceptions ?? { source: 'none' as const, file: null, warnings: [] };
  const entries = exceptions.file?.exceptions ?? [];
  // Control map readings (spec 2026-11-04): only when the map is published for this audience.
  if (controlMapPublished(policies, provider.dataSource)) await collectControlMap(ctx, raws, now);
  const projects = raws.map((raw) => buildProjectSnapshot(raw, policies, now, reusable, entries));
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
    exceptions: {
      source: exceptions.source,
      total: entries.length,
      orphaned: orphanedExceptionIds(
        entries,
        new Set(
          catalog.projects.flatMap((p) =>
            [p.coordinator.repository, ...p.components.map((c) => c.repository)].map((r) =>
              r.toLowerCase(),
            ),
          ),
        ),
      ).slice(0, 100),
    },
    providers: runProviders(providers, usage, opts.providerAuth),
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
  return { index, projects, discovery, teams };
}
