import type { DeploymentsBridgeMap, LedgerRecord } from '@model/index';
import { valueAt } from '../../shared/yaml-value';
import { normaliseVersion } from '../../shared/semver';
import type { AdoClient, AdoRecord } from './ado';
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

export async function runBridge(d: BridgeDeps): Promise<{
  summary: string;
  written: number;
  skipped: number;
}> {
  const since = d.now.getTime() - d.sinceDays * DAY_MS;
  const rows: SummaryRow[] = [];
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
      const envId = await d.ado.environmentId(source.organization, source.project, env.ado);
      if (envId === null) {
        skip('ado-environment-not-found');
        continue;
      }
      const records = (await d.ado.deploymentRecords(source.organization, source.project, envId))
        .filter((r) => !r.finishTime || Date.parse(r.finishTime) >= since)
        .sort((a, b) => Date.parse(a.finishTime ?? '') - Date.parse(b.finishTime ?? ''));
      row.read = records.length;
      const gh = await d.writer(env.repository);
      const reader = await d.reader(env.repository);
      for (const r of records) {
        const outcome = await transcribe(d, source, env, r, gh, reader);
        if (outcome === 'written') row.written++;
        else if (outcome !== 'exists') skip(outcome);
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
  return { summary: renderSummary(rows, header), written, skipped };
}

type Source = DeploymentsBridgeMap['sources'][number];
type Env = Source['environments'][number];

async function transcribe(
  d: BridgeDeps,
  source: Source,
  env: Env,
  r: AdoRecord,
  gh: LedgerGitHub,
  reader: LedgerReader,
): Promise<string> {
  const state = r.result ? STATE[r.result] : undefined;
  if (!state || !r.finishTime) return 'not-completed';
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
      runId: String(r.runId),
      runUrl: r.runUrl,
      attempt: r.attempt,
      ...(version ? { version } : {}),
      ...(r.startTime ? { startedAt: r.startTime } : {}),
      finishedAt: r.finishTime,
      declared: false,
      kind: 'deploy',
    },
  };
  const { outcome } = await writeRecord(gh, record, d.mode);
  return outcome === 'would-write' || outcome === 'status-added' ? 'written' : outcome;
}
