import { describe, expect, it } from 'vitest';
import { DeploymentsBridgeMapSchema } from '@model/index';
import type { AdoClient, AdoRecord } from '../../ledger/src/ado';
import { runBridge } from '../../ledger/src/bridge';
import type { DeploymentRequest, LedgerGitHub, LedgerReader } from '../../ledger/src/github';

/*
 * Azure DevOps pull bridge (deployments ledger spec §5.3, D4, D8): completed ADO environment
 * deployment records become ledger deployments; a commit GitHub does not know is skipped.
 */
const now = new Date('2026-03-01T00:00:00Z');
const SHA = 'b'.repeat(40);
const map = (extra: Record<string, unknown> = {}) =>
  DeploymentsBridgeMapSchema.parse({
    schemaVersion: '1.0',
    sources: [
      {
        type: 'azure-devops',
        organization: 'example-org',
        project: 'example-project',
        environments: [
          {
            ado: 'prod',
            repository: 'example-org/example-service',
            github: 'prod',
            production: true,
            ...extra,
          },
        ],
      },
    ],
  });

const rec = (id: number, result: string | null, finish: string | null, attempt = 1): AdoRecord => ({
  id,
  result,
  startTime: '2026-02-20T09:00:00Z',
  finishTime: finish,
  pipelineId: 7,
  runId: 100 + id,
  attempt,
  runUrl: `https://dev.azure.com/example-org/example-project/_build/results?buildId=${100 + id}`,
});

function fakes(records: AdoRecord[], opts: { known?: boolean | 'unknown'; file?: string } = {}) {
  const created: DeploymentRequest[] = [];
  const stored: { id: number; payload: unknown; statuses: string[] }[] = [];
  const aliases: string[] = [];
  const ado: AdoClient = {
    environmentId: async () => 42,
    deploymentRecords: async () => records,
    runCommit: async (_o, _p, _pl, _run, alias) => {
      aliases.push(alias);
      return SHA;
    },
  };
  const gh: LedgerGitHub = {
    listDeployments: async () => stored,
    createDeployment: async (_r, req) => {
      created.push(req);
      stored.push({ id: stored.length + 1, payload: req.payload, statuses: [] });
      return stored.length;
    },
    createStatus: async (_r, id, state) => {
      stored.find((d) => d.id === id)!.statuses.push(state);
    },
  };
  const reader: LedgerReader = {
    commitExists: async () => opts.known ?? true,
    fileAt: async () => opts.file ?? null,
    tagCommit: async () => null,
  };
  return {
    created,
    aliases,
    deps: { ado, writer: async () => gh, reader: async () => reader },
  };
}

const write = { mode: 'write' as const };

describe('runBridge', () => {
  it('writes completed records and skips the rest (canceled, in progress)', async () => {
    const f = fakes([
      rec(1, 'succeeded', '2026-02-20T09:10:00Z'),
      rec(2, 'failed', '2026-02-21T09:10:00Z'),
      rec(3, 'canceled', '2026-02-22T09:10:00Z'),
      rec(4, null, null),
    ]);
    const r = await runBridge({ map: map(), ...f.deps, mode: write, now, sinceDays: 30 });
    expect(r).toMatchObject({ written: 2, skipped: 2 });
    expect(f.created.map((c) => c.payload.finishedAt)).toEqual([
      '2026-02-20T09:10:00Z',
      '2026-02-21T09:10:00Z',
    ]);
    expect(f.created[0]).toMatchObject({
      ref: SHA,
      environment: 'prod',
      production_environment: true,
      payload: {
        source: 'azure-devops',
        runId: '101',
        attempt: 1,
        startedAt: '2026-02-20T09:00:00Z',
      },
    });
    expect(r.summary).toContain('not-completed: 2');
  });

  it('a commit GitHub does not know is skipped, never invented', async () => {
    const f = fakes([rec(1, 'succeeded', '2026-02-20T09:10:00Z')], { known: false });
    const r = await runBridge({ map: map(), ...f.deps, mode: write, now, sinceDays: 30 });
    expect(r).toMatchObject({ written: 0, skipped: 1 });
    expect(f.created).toHaveLength(0);
    expect(r.summary).toContain('commit-not-on-github: 1');
  });

  it('an unverifiable commit is skipped too', async () => {
    const f = fakes([rec(1, 'succeeded', '2026-02-20T09:10:00Z')], { known: 'unknown' });
    const r = await runBridge({ map: map(), ...f.deps, mode: write, now, sinceDays: 30 });
    expect(r.summary).toContain('commit-unverified: 1');
  });

  it('a second run over the same records writes nothing', async () => {
    const f = fakes([rec(1, 'succeeded', '2026-02-20T09:10:00Z')]);
    await runBridge({ map: map(), ...f.deps, mode: write, now, sinceDays: 30 });
    const again = await runBridge({ map: map(), ...f.deps, mode: write, now, sinceDays: 30 });
    expect(again.written).toBe(0);
    expect(f.created).toHaveLength(1);
  });

  it('reads the version from the versions file at the commit', async () => {
    const f = fakes([rec(1, 'succeeded', '2026-02-20T09:10:00Z')], { file: 'umbrella: 0.5.2\n' });
    await runBridge({
      map: map({ versionFrom: { file: 'environments/prod.yaml', key: 'umbrella' } }),
      ...f.deps,
      mode: write,
      now,
      sinceDays: 30,
    });
    expect(f.created[0]!.payload.version).toBe('0.5.2');
  });

  it('takes the commit from the commitFrom repository alias', async () => {
    const f = fakes([rec(1, 'succeeded', '2026-02-20T09:10:00Z')]);
    await runBridge({
      map: map({ commitFrom: 'mirror' }),
      ...f.deps,
      mode: write,
      now,
      sinceDays: 30,
    });
    expect(f.aliases).toEqual(['mirror']);
  });

  it('dry-run reads and reports but never creates', async () => {
    const f = fakes([rec(1, 'succeeded', '2026-02-20T09:10:00Z')]);
    const r = await runBridge({
      map: map(),
      ...f.deps,
      mode: { mode: 'dry-run', reason: 'mode-variable' },
      now,
      sinceDays: 30,
    });
    expect(f.created).toHaveLength(0);
    expect(r.summary).toContain('dry-run');
    expect(r.summary).toContain('HUB_DEPLOYMENTS_BRIDGE');
  });

  it('an ADO environment that does not exist is reported, nothing written', async () => {
    const f = fakes([]);
    f.deps.ado.environmentId = async () => null;
    const r = await runBridge({ map: map(), ...f.deps, mode: write, now, sinceDays: 30 });
    expect(r.summary).toContain('ado-environment-not-found: 1');
  });
});
