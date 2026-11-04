import type { DeploymentsBridgeMap, LedgerRecord } from '@model/index';
import { valueAt } from '../../shared/yaml-value';
import { normaliseVersion } from '../../shared/semver';
import { AdoError, type AdoClient, type AdoRecord } from './ado';
import type { LedgerGitHub, LedgerReader } from './github';
import type { LedgerMode } from './mode';
import { renderSummary, type SummaryRow } from './summary';
import { writeRecord } from './writer';

/*
 * Azure DevOps pull bridge (deployments ledger spec §5.3). For each mapped ADO environment: read
 * its deployment records, keep the completed ones (succeeded → success, failed → failure; any
 * other result is not written), take the commit of the run, check GitHub knows it (D8), read
 * the version if the map says where, and write the ledger record (idempotent, D4).
 */

const DAY_MS = 86_400_000;

export interface BridgeDeps {
  map: DeploymentsBridgeMap;
  ado: AdoClient;
  writer: (repo: string) => Promise<LedgerGitHub>;
  reader: (repo: string) => Promise<LedgerReader>;
  mode: LedgerMode;
  now: Date;
  sinceDays: number;
}

const STATE: Record<string, LedgerRecord['state'] | undefined> = {
  succeeded: 'success',
  succeededWithIssues: 'success',
  failed: 'failure',
};

/** Records of one stage attempt of one run: ADO keeps one record per deployment job. */
type Group = AdoRecord[];

function groupByStage(records: readonly AdoRecord[]): Group[] {
  const groups = new Map<string, Group>();
  for (const r of records) {
    const key = `${r.runId}|${r.stage}|${r.attempt}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()];
}

const latest = (g: Group) => Math.max(...g.map((r) => Date.parse(r.finishTime ?? '') || 0));

/** Why a writer failed on one environment, as a summary reason (no message, no body). */
function errorReason(e: unknown): string {
  if (e instanceof AdoError) return `ado-error-${e.status}`;
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 404) return 'github-app-not-installed';
  return typeof status === 'number' ? `github-error-${status}` : 'error';
}

export async function runBridge(d: BridgeDeps): Promise<{
  summary: string;
  written: number;
  skipped: number;
  failed: number;
}> {
  const since = d.now.getTime() - d.sinceDays * DAY_MS;
  const rows: SummaryRow[] = [];
  let failed = 0;
  for (const source of d.map.sources) {
    for (const env of source.environments) {
      const row: SummaryRow = {
        repository: env.repository,
        environment: env.github,
        read: 0,
        written: 0,
        skipped: [],
      };
      rows.push(row);
      const skip = (reason: string) => {
        const s = row.skipped.find((x) => x.reason === reason);
        if (s) s.count++;
        else row.skipped.push({ reason, count: 1 });
      };
      // One environment failing never stops the others; the run fails at the end.
      try {
        const envId = await d.ado.environmentId(source.organization, source.project, env.ado);
        if (envId === null) {
          skip('ado-environment-not-found');
          continue;
        }
        const groups = groupByStage(
          await d.ado.deploymentRecords(source.organization, source.project, envId),
        )
          .filter((g) => g.some((r) => !r.finishTime) || latest(g) >= since)
          .sort((a, b) => latest(a) - latest(b));
        row.read = groups.length;
        const gh = await d.writer(env.repository);
        const reader = await d.reader(env.repository);
        for (const g of groups) {
          const outcome = await transcribe(d, source, env, g, gh, reader);
          if (outcome === 'written') row.written++;
          else if (outcome !== 'exists') skip(outcome);
        }
      } catch (e) {
        failed++;
        skip(errorReason(e));
      }
    }
  }
  const written = rows.reduce((a, r) => a + r.written, 0);
  const skipped = rows.reduce((a, r) => a + r.skipped.reduce((b, s) => b + s.count, 0), 0);
  const header =
    d.mode.mode === 'write'
      ? '### Deployments bridge: write\n'
      : `### Deployments bridge: dry-run (${
          d.mode.reason === 'mode-input'
            ? 'input mode is not "write"'
            : 'repository variable HUB_DEPLOYMENTS_BRIDGE is not "write"'
        })\n`;
  return { summary: renderSummary(rows, header), written, skipped, failed };
}

type Source = DeploymentsBridgeMap['sources'][number];
type Env = Source['environments'][number];

async function transcribe(
  d: BridgeDeps,
  source: Source,
  env: Env,
  group: Group,
  gh: LedgerGitHub,
  reader: LedgerReader,
): Promise<string> {
  // A stage is one deploy: complete only when every job finished; failed if any job failed.
  if (group.some((r) => !r.result || !r.finishTime)) return 'not-completed';
  const states = group.map((r) => STATE[r.result!]);
  const state: LedgerRecord['state'] | undefined = group.some((r) => r.result === 'failed')
    ? 'failure'
    : states.every((s) => s === 'success')
      ? 'success'
      : undefined;
  if (!state) return 'not-completed';
  const r = group[0]!;
  const last = group.reduce((a, b) =>
    (Date.parse(b.finishTime!) || 0) > (Date.parse(a.finishTime!) || 0) ? b : a,
  );
  const finishTime = last.finishTime!;
  const starts = group
    .map((x) => x.startTime)
    .filter((t): t is string => !!t)
    .sort();
  const sha = await d.ado.runCommit(
    source.organization,
    source.project,
    r.pipelineId,
    r.runId,
    env.commitFrom,
  );
  if (!sha) return 'commit-unreadable';
  const known = await reader.commitExists(env.repository, sha);
  if (known === 'unknown') return 'commit-unverified';
  if (!known) return 'commit-not-on-github';
  let version: string | undefined;
  if (env.versionFrom) {
    const text = await reader.fileAt(env.repository, env.versionFrom.file, sha);
    version = normaliseVersion(text ? valueAt(text, env.versionFrom.key) : null) ?? undefined;
  }
  const record: LedgerRecord = {
    repository: env.repository,
    environment: env.github,
    sha,
    production: env.production,
    state,
    description: `Azure DevOps run ${r.runId} (${env.ado})`.slice(0, 140),
    payload: {
      ledger: 1,
      source: 'azure-devops',
      runId: `${r.runId}/${r.stage}`.slice(0, 100),
      runUrl: r.runUrl,
      attempt: r.attempt,
      ...(version ? { version } : {}),
      ...(starts[0] ? { startedAt: starts[0] } : {}),
      finishedAt: finishTime,
      declared: false,
      kind: 'deploy',
    },
  };
  const { outcome } = await writeRecord(gh, record, d.mode);
  return outcome === 'would-write' || outcome === 'status-added' ? 'written' : outcome;
}
