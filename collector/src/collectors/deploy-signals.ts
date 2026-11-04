import { parse } from 'yaml';
import {
  LedgerPayloadSchema,
  type ControlReason,
  type LedgerPayload,
  type ProjectConfig,
} from '@model/index';
import type { ArgoApplicationDTO } from '../providers/external/types';
import type {
  DeploymentDTO,
  DeploymentStatusDTO,
  ProviderError,
  ProviderResult,
  SourceProvider,
  WorkflowRunDTO,
} from '../providers/types';
import type { DeployEvent, DeploySignalType } from '../evaluators/delivery-metrics';
import { compareVersions, normaliseVersion, parseVersion } from '../util/semver';

/*
 * Deploy events of one environment from its catalog deploy signal (spec §5.3, C6). Read-only GETs:
 * workflow runs already collected, the commits of a versions file and the file at each commit,
 * Argo CD history already collected, published releases. Unknown is never 0: an unreadable
 * signal gives no events and a reason.
 */

type Environment = ProjectConfig['environments'][number];

export interface DeploySignalInput {
  config: ProjectConfig;
  workflows: { workflow: { id: string }; runs: ProviderResult<WorkflowRunDTO[]> }[];
  argocd?: Map<string, ProviderResult<ArgoApplicationDTO> | 'off'>;
  /** Repository metadata already read: an unreadable repository is not called again. */
  repos?: { repository: string; repo: ProviderResult<unknown> }[];
}

export interface DeploySignalResult {
  events: DeployEvent[];
  signal: DeploySignalType;
  reason: ControlReason | null;
  notes: string[];
  /** The provider error that made the signal unreadable, for the collection errors. */
  error: ProviderError | null;
  /** Repository the error came from. */
  repository: string | null;
}

/** Versions-file commits read in the trend window (newest kept). */
export const MAX_VERSION_COMMITS = 50;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const reasonOf = (e: ProviderError): ControlReason =>
  e.classification === 'not-authorised' ? 'needs-permission' : 'source-unreadable';

const hoursBetween = (from: string | null | undefined, to: string): number | null => {
  if (!from) return null;
  const h = (Date.parse(to) - Date.parse(from)) / HOUR_MS;
  return Number.isFinite(h) && h >= 0 ? Math.round(h * 10) / 10 : null;
};

/** The value at a dot path of a YAML or JSON document, as text; null when absent or not scalar. */
export function valueAt(text: string, key: string): string | null {
  let doc: unknown;
  try {
    doc = parse(text, { maxAliasCount: 100, uniqueKeys: false, logLevel: 'error' });
  } catch {
    return null;
  }
  let node: unknown = doc;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' || typeof node === 'number' ? String(node).trim() : null;
}

/** Completed successful / failed runs in the window as deploy events, oldest first. */
function runEvents(runs: readonly WorkflowRunDTO[], since: number): DeployEvent[] {
  return [...new Map(runs.map((r) => [r.id, r])).values()]
    .filter((r) => r.status === 'completed' && r.event !== 'pull_request')
    .filter((r) => r.conclusion === 'success' || r.conclusion === 'failure')
    .filter((r) => Date.parse(r.updatedAt) >= since)
    .map((r) => ({
      at: r.updatedAt,
      kind: r.conclusion === 'success' ? ('deploy' as const) : ('failure' as const),
      version: null,
      leadHours: r.conclusion === 'success' ? hoursBetween(r.headCommitAt, r.updatedAt) : null,
    }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Ledger payload of a deployment, or null (Actions jobs and anything that does not parse). */
function ledgerPayload(raw: unknown): LedgerPayload | null {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = LedgerPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Deploy events of one environment from its GitHub deployments (deployments ledger spec §5.5).
 * A success status is a deploy (even if later inactive), failure/error a failure, anything else
 * nothing. The time is the ledger's `finishedAt` (D10), else the final status time.
 */
async function ledgerEvents(
  provider: SourceProvider,
  repository: string,
  signal: Extract<Environment['deploySignal'], { type: 'github-deployments' }>,
  deployments: DeploymentDTO[],
  listStatuses: (repo: string, id: number) => Promise<ProviderResult<DeploymentStatusDTO[]>>,
  since: number,
  base: Omit<DeploySignalResult, 'events' | 'reason'>,
): Promise<DeploySignalResult> {
  const candidates = deployments
    .map((d) => ({ d, payload: ledgerPayload(d.payload) }))
    .filter(({ payload }) => {
      const source = payload?.source ?? 'github-actions';
      return !signal.sources || signal.sources.includes(source);
    });
  if (candidates.length === 0)
    return { ...base, events: [], reason: 'source-unreadable', notes: ['no deployment recorded'] };
  const inWindow = candidates
    .filter(({ d, payload }) => Date.parse(payload?.finishedAt ?? d.createdAt) >= since)
    .slice(0, MAX_LEDGER_DEPLOYMENTS);
  const dates = new Map<string, Promise<string | null>>();
  const commitDate = (ref: string) => {
    if (!dates.has(ref))
      dates.set(
        ref,
        provider.getCommitDate
          ? provider.getCommitDate(repository, ref).then((r) => (r.ok ? r.data : null))
          : Promise.resolve(null),
      );
    return dates.get(ref)!;
  };
  const raw: { at: string; kind: DeployEvent['kind']; version: string | null; sha: string }[] = [];
  let declared = 0;
  for (const { d, payload } of inWindow) {
    const statuses = await listStatuses(repository, d.id);
    if (!statuses.ok) continue;
    const success = statuses.data.find((s) => s.state === 'success');
    const failed = statuses.data.find((s) => s.state === 'failure' || s.state === 'error');
    const final = success ?? failed;
    if (!final) continue;
    if (payload?.declared) declared++;
    raw.push({
      at: payload?.finishedAt ?? final.createdAt,
      kind: success ? (payload?.kind === 'rollback' ? 'rollback' : 'deploy') : 'failure',
      version: payload?.version ?? null,
      sha: d.sha,
    });
  }
  raw.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const events: DeployEvent[] = [];
  let previous: string | null = null;
  for (const e of raw) {
    let kind = e.kind;
    const version = e.version ? normaliseVersion(e.version) : null;
    if (kind === 'deploy' && version && previous && (compareVersions(version, previous) ?? 0) < 0)
      kind = 'rollback';
    if (kind !== 'failure' && version) previous = version;
    let leadHours: number | null = null;
    if (kind === 'deploy') {
      const tagged = version ? await commitDate(`${signal.tagPrefix}${version}`) : null;
      leadHours = hoursBetween(tagged ?? (await commitDate(e.sha)), e.at);
    }
    events.push({ at: e.at, kind, version, leadHours });
  }
  const notes = declared ? [`includes ${declared} declared`] : [];
  return { ...base, notes, events, reason: null };
}

/** Deployments read per environment and collection (newest first). */
const MAX_LEDGER_DEPLOYMENTS = 100;

/** Argo CD keeps `revisionHistoryLimit` entries (10 by default). */
const ARGO_HISTORY_LIMIT = 10;

export async function collectDeploySignal(
  provider: SourceProvider,
  raw: DeploySignalInput,
  env: Environment,
  now: Date,
  windows: { frequencyDays: number; trendDays: number },
): Promise<DeploySignalResult> {
  const signal = env.deploySignal;
  const base = { signal: signal.type, notes: [] as string[], error: null, repository: null };
  const none = (reason: ControlReason, extra: Partial<DeploySignalResult> = {}) => ({
    ...base,
    events: [],
    reason,
    ...extra,
  });
  const since = now.getTime() - windows.trendDays * DAY_MS;
  // Already reported once as the repository error: no second call, no second error.
  const unreadable = (repository: string) =>
    raw.repos?.some((r) => r.repository === repository && !r.repo.ok) ?? false;

  switch (signal.type) {
    case 'external':
      return none('external-pipelines');

    case 'github-deployments': {
      const repository =
        signal.repository === 'coordinator'
          ? raw.config.coordinator.repository
          : raw.config.components.find((c) => c.id === signal.repository)?.repository;
      const listDeployments = provider.listDeployments?.bind(provider);
      const listStatuses = provider.listDeploymentStatuses?.bind(provider);
      if (!repository || !listDeployments || !listStatuses || unreadable(repository))
        return none('source-unreadable');
      const environment = signal.environment ?? env.githubEnvironment ?? env.id;
      const list = await listDeployments(repository, environment);
      if (!list.ok) return none(reasonOf(list.error), { error: list.error, repository });
      return ledgerEvents(provider, repository, signal, list.data, listStatuses, since, base);
    }

    case 'workflow': {
      const tracked = raw.config.trackedWorkflows.find((w) => w.id === signal.workflow);
      const listSince = provider.listWorkflowRunsSince?.bind(provider);
      if (tracked && listSince) {
        // The delivery workflow is read over the whole window and on every ref: a deploy on a
        // tag push has head_branch = the tag, so the default-branch list would miss it.
        const targets = tracked.appliesTo ?? raw.config.components.map((c) => c.id);
        const repos = [
          ...new Set(
            targets.map((id) =>
              id === 'coordinator'
                ? raw.config.coordinator.repository
                : raw.config.components.find((c) => c.id === id)?.repository,
            ),
          ),
        ].filter((r): r is string => !!r && !unreadable(r));
        if (repos.length === 0) return none('source-unreadable');
        const sinceIso = new Date(since).toISOString();
        const results = await Promise.all(repos.map((r) => listSince(r, tracked.file, sinceIso)));
        const okResults = results.filter((r) => r.ok);
        if (okResults.length === 0) {
          const err = results.find((r) => !r.ok);
          return err && !err.ok
            ? none(reasonOf(err.error), { error: err.error, repository: repos[0]! })
            : none('source-unreadable');
        }
        const notes = okResults.some((r) => r.ok && r.data.truncated)
          ? ['run list truncated: the frequency is at least this']
          : [];
        const runs = okResults.flatMap((r) => (r.ok ? r.data.runs : []));
        return { ...base, notes, events: runEvents(runs, since), reason: null };
      }
      const data = raw.workflows.filter((w) => w.workflow.id === signal.workflow);
      const readable = data.filter((w) => w.runs.ok);
      if (readable.length === 0) {
        const err = data.find((w) => !w.runs.ok)?.runs;
        return none(err && !err.ok ? reasonOf(err.error) : 'source-unreadable');
      }
      const events = runEvents(
        readable.flatMap((w) => (w.runs.ok ? w.runs.data : [])),
        since,
      );
      return { ...base, events, reason: null };
    }

    case 'argocd': {
      const app = raw.argocd?.get(env.id);
      if (!app || app === 'off') return none('no-argocd');
      if (!app.ok) return none(reasonOf(app.error));
      const history = app.data.deployHistory ?? [];
      const events: DeployEvent[] = history
        .filter((at) => Date.parse(at) >= since)
        .map((at) => ({ at, kind: 'deploy' as const, version: null, leadHours: null }));
      const notes =
        history.length >= ARGO_HISTORY_LIMIT
          ? ['Argo CD keeps a limited history: the frequency is at least this']
          : [];
      return { ...base, notes, events, reason: null };
    }

    case 'release': {
      const repository = raw.config.coordinator.repository;
      if (!provider.listReleases || unreadable(repository)) return none('source-unreadable');
      const releases = await provider.listReleases(repository);
      if (!releases.ok)
        return none(reasonOf(releases.error), { error: releases.error, repository });
      const events: DeployEvent[] = releases.data
        .filter((r) => !r.prerelease && r.publishedAt && Date.parse(r.publishedAt) >= since)
        .map((r) => ({
          at: r.publishedAt!,
          kind: 'deploy' as const,
          version: r.tagName,
          leadHours: null,
        }))
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      return { ...base, events, reason: null };
    }

    case 'versions-file': {
      const repository =
        signal.repository === 'coordinator'
          ? raw.config.coordinator.repository
          : raw.config.components.find((c) => c.id === signal.repository)?.repository;
      if (!repository || !provider.listCommitsForPath || unreadable(repository))
        return none('source-unreadable');
      const commits = await provider.listCommitsForPath(repository, signal.path);
      if (!commits.ok) return none(reasonOf(commits.error), { error: commits.error, repository });
      const dated = commits.data
        .filter((c) => c.committedAt && Number.isFinite(Date.parse(c.committedAt)))
        .sort((a, b) => Date.parse(a.committedAt!) - Date.parse(b.committedAt!));
      // A path no commit touches is a misconfiguration, not "no deploy": not visible.
      if (dated.length === 0)
        return none('source-unreadable', { notes: ['no commit touches the path'], repository });
      const inWindow = dated
        .filter((c) => Date.parse(c.committedAt!) >= since)
        .slice(-MAX_VERSION_COMMITS);
      const baseline = dated.filter((c) => Date.parse(c.committedAt!) < since).at(-1);
      const notes: string[] = [];
      const read = async (sha: string): Promise<string | null | 'unreadable'> => {
        const file = await provider.getFile(repository, signal.path, sha);
        if (!file.ok) return 'unreadable';
        return valueAt(file.data.text, signal.key);
      };
      const semverOf = (v: string | null) => {
        const n = normaliseVersion(v);
        return n && parseVersion(n) ? n : null;
      };
      let previous: string | null = null;
      if (baseline) {
        const v = await read(baseline.sha);
        previous = v === 'unreadable' ? null : semverOf(v);
      }
      let seenVersion = previous !== null;
      const events: DeployEvent[] = [];
      for (const c of inWindow) {
        const raw = await read(c.sha);
        const short = c.sha.slice(0, 7);
        if (raw === 'unreadable') {
          notes.push(`unreadable file at ${short}`);
          continue;
        }
        const version = semverOf(raw);
        if (!version) {
          notes.push(`non-semver value at ${short}`);
          continue;
        }
        seenVersion = true;
        const order = previous === null ? 1 : compareVersions(version, previous);
        previous = version;
        if (!order) continue; // equal: a commit that did not change the version
        const at = c.committedAt!;
        if (order < 0) {
          events.push({ at, kind: 'rollback', version, leadHours: null });
          continue;
        }
        let leadHours: number | null = null;
        if (provider.getCommitDate) {
          const tagged = await provider.getCommitDate(repository, `${signal.tagPrefix}${version}`);
          if (tagged.ok) leadHours = hoursBetween(tagged.data, at);
        }
        events.push({ at, kind: 'deploy', version, leadHours });
      }
      // No commit held a version at `key` (a wrong key or path): not visible, never 0 deploys.
      if (!seenVersion)
        return none('source-unreadable', { notes: [...notes, 'no version found at the key'] });
      return { ...base, notes, events, reason: null };
    }
  }
}
