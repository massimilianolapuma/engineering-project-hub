import { parse } from 'yaml';
import type { ControlReason, ProjectConfig } from '@model/index';
import type { ArgoApplicationDTO } from '../providers/external/types';
import type {
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

    case 'workflow': {
      const data = raw.workflows.filter((w) => w.workflow.id === signal.workflow);
      const readable = data.filter((w) => w.runs.ok);
      if (readable.length === 0) {
        const err = data.find((w) => !w.runs.ok)?.runs;
        return none(err && !err.ok ? reasonOf(err.error) : 'source-unreadable');
      }
      const events: DeployEvent[] = readable
        .flatMap((w) => (w.runs.ok ? w.runs.data : []))
        .filter((r) => r.status === 'completed')
        .filter((r) => r.conclusion === 'success' || r.conclusion === 'failure')
        .filter((r) => Date.parse(r.updatedAt) >= since)
        .map((r) => ({
          at: r.updatedAt,
          kind: r.conclusion === 'success' ? ('deploy' as const) : ('failure' as const),
          version: null,
          leadHours: r.conclusion === 'success' ? hoursBetween(r.headCommitAt, r.updatedAt) : null,
        }))
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      return { ...base, events, reason: null };
    }

    case 'argocd': {
      const app = raw.argocd?.get(env.id);
      if (!app || app === 'off') return none('no-argocd');
      if (!app.ok) return none(reasonOf(app.error));
      const events: DeployEvent[] = (app.data.deployHistory ?? [])
        .filter((at) => Date.parse(at) >= since)
        .map((at) => ({ at, kind: 'deploy' as const, version: null, leadHours: null }));
      return { ...base, events, reason: null };
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
      return { ...base, notes, events, reason: null };
    }
  }
}
