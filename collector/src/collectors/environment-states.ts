import { valueAt } from '../../../shared/yaml-value';
import type { ProjectConfig } from '@model/index';
import { ok, type ProviderResult, type SourceProvider } from '../providers/types';
import { normaliseVersion, parseVersion } from '../util/semver';
import { call, type CollectContext, type RawProjectData } from './collect';
import { ledgerPayload } from './deploy-signals';

/*
 * Current state of each environment from its deploy signal, for the Versions page (snapshot
 * 1.10). Read-only GETs, one per environment plus the statuses of the newest deployments:
 * - versions-file: the version declared at `key` in the file on the default branch;
 * - github-deployments: the newest deployment with a success status (version from the ledger
 *   payload, else from a version-like tag ref).
 * The delivery metrics of the control map read the same sources over a window; this reads only
 * what holds now, for every environment.
 */

type Environment = ProjectConfig['environments'][number];

/** The newest successful GitHub deployment of an environment. */
export interface LedgerCurrent {
  version: string | null;
  /** Branch or tag the deployment was made from, when GitHub reports one. */
  ref: string | null;
  sha: string;
  deployedAt: string;
  /** Declared by hand (ledger payload `declared`), not reported by a pipeline. */
  declared: boolean;
}

/** One read of an environment's GitHub Deployments. */
export interface LedgerRead {
  /** The newest deployment with a success status; null when none was found. */
  current: LedgerCurrent | null;
  /** Deployments of the environment after the source filter: 0 means "none at all". */
  candidates: number;
}

export interface EnvironmentState {
  repository: string;
  /** versions-file: the declared semver; ok(null) when the key holds no semver value. */
  declared?: ProviderResult<string | null>;
  /** github-deployments: the newest successful deployment; ok(null) when there is none. */
  ledger?: ProviderResult<LedgerCurrent | null>;
}

/** Deployments whose statuses are read, newest first, before giving up on finding a success. */
export const MAX_STATUS_READS = 10;

const FULL_SHA = /^[0-9a-f]{40}$/;

function semverOf(raw: string | null | undefined, prefix = 'v'): string | null {
  const v = normaliseVersion(raw, prefix);
  return v && parseVersion(v) ? v : null;
}

function repositoryOf(config: ProjectConfig, id: string): string | undefined {
  return id === 'coordinator'
    ? config.coordinator.repository
    : config.components.find((c) => c.id === id)?.repository;
}

/**
 * The newest successful GitHub deployment of `environment` in `repository`. Null when the
 * provider cannot list deployments. `current: null` with candidates means that none of the
 * newest `MAX_STATUS_READS` deployments succeeded, not that nothing was ever deployed.
 */
export async function readLedger(
  provider: SourceProvider,
  repository: string,
  environment: string,
  opts: { tagPrefix: string; sources?: readonly string[] },
): Promise<ProviderResult<LedgerRead> | null> {
  const listDeployments = provider.listDeployments?.bind(provider);
  const listStatuses = provider.listDeploymentStatuses?.bind(provider);
  if (!listDeployments || !listStatuses) return null;
  const list = await listDeployments(repository, environment);
  if (!list.ok) return list;
  const filtered = list.data
    .map((d) => ({ d, payload: ledgerPayload(d.payload) }))
    .filter(({ payload }) => {
      const source = payload?.source ?? 'github-actions';
      return !opts.sources || opts.sources.includes(source);
    });
  const candidates = filtered
    // Newest real deploy first: a ledger record may be written after the deploy (D10).
    .sort(
      (a, b) =>
        Date.parse(b.payload?.finishedAt ?? b.d.createdAt) -
        Date.parse(a.payload?.finishedAt ?? a.d.createdAt),
    )
    .slice(0, MAX_STATUS_READS);
  for (const { d, payload } of candidates) {
    const statuses = await listStatuses(repository, d.id);
    if (!statuses.ok) return statuses;
    const success = statuses.data.find((s) => s.state === 'success');
    if (!success) continue;
    const ref = d.ref && !FULL_SHA.test(d.ref) ? d.ref : null;
    return ok({
      current: {
        version: semverOf(payload?.version) ?? semverOf(ref, opts.tagPrefix),
        ref,
        sha: d.sha,
        deployedAt: payload?.finishedAt ?? success.createdAt,
        declared: payload?.declared ?? false,
      },
      candidates: filtered.length,
    });
  }
  return ok({ current: null, candidates: filtered.length });
}

export async function readEnvironmentState(
  provider: SourceProvider,
  config: ProjectConfig,
  env: Environment,
  unreadable: (repository: string) => boolean = () => false,
): Promise<EnvironmentState | null> {
  const signal = env.deploySignal;
  if (signal.type === 'versions-file') {
    const repository = repositoryOf(config, signal.repository);
    if (!repository || unreadable(repository)) return null;
    const file = await provider.getFile(repository, signal.path);
    if (!file.ok) return { repository, declared: file };
    return { repository, declared: ok(semverOf(valueAt(file.data.text, signal.key))) };
  }
  if (signal.type === 'github-deployments') {
    const repository = repositoryOf(config, signal.repository);
    if (!repository || unreadable(repository)) return null;
    const read = await readLedger(
      provider,
      repository,
      signal.environment ?? env.githubEnvironment ?? env.id,
      { tagPrefix: signal.tagPrefix, sources: signal.sources },
    );
    if (!read) return null;
    return { repository, ledger: read.ok ? ok(read.data.current) : read };
  }
  return null;
}

/** Reads the state of every environment whose signal can say what it runs now. */
export async function collectEnvironmentStates(
  ctx: CollectContext,
  raws: RawProjectData[],
): Promise<void> {
  const p = ctx.provider;
  await Promise.all(
    raws.map(async (raw) => {
      // Already reported once as the repository error: no second call, no second error.
      const unreadable = (repository: string) =>
        raw.repos.some((r) => r.repository === repository && !r.repo.ok);
      const states = new Map<string, EnvironmentState>();
      for (const env of raw.config.environments) {
        const state = await call(ctx, `env-state:${raw.config.id}:${env.id}`, async () =>
          ok(await readEnvironmentState(p, raw.config, env, unreadable)),
        );
        if (state.ok && state.data) states.set(env.id, state.data);
      }
      raw.environmentStates = states;
    }),
  );
}
