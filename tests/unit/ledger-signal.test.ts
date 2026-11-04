import { describe, expect, it } from 'vitest';
import type { ProjectConfig } from '@model/index';
import { collectDeploySignal } from '../../collector/src/collectors/deploy-signals';
import { deliveryMetrics } from '../../collector/src/evaluators/delivery-metrics';
import { loadConfig } from '../../collector/src/config/load';
import {
  fail,
  ok,
  type DeploymentDTO,
  type DeploymentStatusDTO,
  type SourceProvider,
} from '../../collector/src/providers/types';

/*
 * Hub signal `github-deployments` (deployments ledger spec §5.5): reads GitHub Deployments of an
 * environment, with the real deploy time from the ledger payload (D10).
 */
const now = new Date('2026-03-01T00:00:00Z');
const windows = { frequencyDays: 30, trendDays: 90 };
const SHA = 'a'.repeat(40);

const ledger = (runId: string, finishedAt: string, extra: Record<string, unknown> = {}) => ({
  ledger: 1,
  source: 'azure-devops',
  runId,
  runUrl: `https://dev.azure.com/example-org/example-project/_build/results?buildId=${runId}`,
  attempt: 1,
  finishedAt,
  ...extra,
});
const dep = (id: number, createdAt: string, payload: unknown = {}): DeploymentDTO => ({
  id,
  sha: SHA,
  environment: 'prod',
  createdAt,
  payload,
  creator: 'example-app[bot]',
});
const st = (state: string, createdAt = '2026-02-28T12:00:00Z'): DeploymentStatusDTO => ({
  state,
  createdAt,
});

async function run(
  deployments: DeploymentDTO[],
  statuses: Record<number, DeploymentStatusDTO[]>,
  signal: Partial<{ sources: string[] }> = {},
) {
  const base = (await loadConfig('config')).catalog.projects.find((p) => p.id === 'project-alpha')!;
  const p: ProjectConfig = {
    ...base,
    environments: [
      {
        id: 'prod',
        name: 'PROD',
        deploySignal: {
          type: 'github-deployments',
          repository: 'coordinator',
          tagPrefix: 'v',
          ...(signal as object),
        } as ProjectConfig['environments'][number]['deploySignal'],
      },
    ],
  };
  const provider = {
    listDeployments: async () => ok(deployments),
    listDeploymentStatuses: async (_r: string, id: number) => ok(statuses[id] ?? []),
    getCommitDate: async () => ok('2026-01-01T00:00:00Z'),
  } as unknown as SourceProvider;
  return collectDeploySignal(
    provider,
    { config: p, workflows: [] },
    p.environments[0]!,
    now,
    windows,
  );
}

describe('github-deployments signal', () => {
  it('a backfill run places each deploy at its real finishedAt, not at the write time', async () => {
    const r = await run(
      [
        dep(1, '2026-02-28T10:00:00Z', ledger('1', '2026-02-01T10:00:00Z')),
        dep(2, '2026-02-28T10:00:01Z', ledger('2', '2026-02-08T10:00:00Z')),
        dep(3, '2026-02-28T10:00:02Z', ledger('3', '2026-02-15T10:00:00Z')),
      ],
      { 1: [st('success')], 2: [st('success')], 3: [st('success')] },
    );
    expect(r.reason).toBeNull();
    expect(r.events.map((e) => e.at)).toEqual([
      '2026-02-01T10:00:00Z',
      '2026-02-08T10:00:00Z',
      '2026-02-15T10:00:00Z',
    ]);
    expect(deliveryMetrics(r.events, 'github-deployments', windows, now).frequencyPerWeek).toBe(
      Math.round((3 / 30) * 700) / 100,
    );
  });

  it('ignores in-progress deployments and counts success later marked inactive', async () => {
    const r = await run(
      [
        dep(1, '2026-02-20T10:00:00Z'),
        dep(2, '2026-02-21T10:00:00Z'),
        dep(3, '2026-02-22T10:00:00Z'),
      ],
      {
        1: [st('in_progress', '2026-02-20T10:00:00Z')],
        2: [st('success', '2026-02-21T10:05:00Z'), st('inactive', '2026-02-22T10:05:00Z')],
        3: [st('error', '2026-02-22T10:05:00Z')],
      },
    );
    expect(r.events.map((e) => [e.kind, e.at])).toEqual([
      ['deploy', '2026-02-21T10:05:00Z'],
      ['failure', '2026-02-22T10:05:00Z'],
    ]);
  });

  it('notes declared records and detects rollbacks by kind and by version', async () => {
    const r = await run(
      [
        dep(1, '2026-02-10T00:00:00Z', ledger('1', '2026-02-10T00:00:00Z', { version: '1.2.0' })),
        dep(
          2,
          '2026-02-11T00:00:00Z',
          ledger('2', '2026-02-11T00:00:00Z', {
            version: '1.1.0',
            source: 'manual',
            declared: true,
          }),
        ),
        dep(3, '2026-02-12T00:00:00Z', ledger('3', '2026-02-12T00:00:00Z', { kind: 'rollback' })),
      ],
      { 1: [st('success')], 2: [st('success')], 3: [st('success')] },
    );
    expect(r.events.map((e) => e.kind)).toEqual(['deploy', 'rollback', 'rollback']);
    expect(r.notes).toContain('includes 1 declared');
  });

  it('the sources filter drops deployments from other creators', async () => {
    const r = await run(
      [
        dep(1, '2026-02-10T00:00:00Z'),
        dep(2, '2026-02-11T00:00:00Z', ledger('2', '2026-02-11T00:00:00Z')),
      ],
      { 1: [st('success')], 2: [st('success')] },
      { sources: ['azure-devops'] },
    );
    expect(r.events).toHaveLength(1);
  });

  it('accepts a payload sent as a JSON string', async () => {
    const r = await run(
      [dep(1, '2026-02-28T00:00:00Z', JSON.stringify(ledger('1', '2026-02-03T00:00:00Z')))],
      { 1: [st('success')] },
    );
    expect(r.events[0]?.at).toBe('2026-02-03T00:00:00Z');
  });

  it('no deployment at all is not visible ("no deployment recorded"), never 0', async () => {
    const r = await run([], {});
    expect(r).toMatchObject({ events: [], reason: 'source-unreadable' });
    expect(r.notes).toContain('no deployment recorded');
  });

  it('only older deployments: frequency is a measured 0', async () => {
    const r = await run([dep(1, '2025-06-01T00:00:00Z')], {
      1: [st('success', '2025-06-01T00:00:00Z')],
    });
    expect(r).toMatchObject({ events: [], reason: null });
  });

  it('a 403 is not visible with needs-permission and an error', async () => {
    const base = (await loadConfig('config')).catalog.projects.find(
      (p) => p.id === 'project-alpha',
    )!;
    const env = {
      id: 'prod',
      name: 'PROD',
      deploySignal: {
        type: 'github-deployments',
        repository: 'coordinator',
        tagPrefix: 'v',
      } as const,
    };
    const provider = {
      listDeployments: async () =>
        fail({ classification: 'not-authorised' as const, httpStatus: 403 }),
      listDeploymentStatuses: async () => ok([]),
    } as unknown as SourceProvider;
    const r = await collectDeploySignal(
      provider,
      { config: { ...base, environments: [env] }, workflows: [] },
      env,
      now,
      windows,
    );
    expect(r).toMatchObject({
      reason: 'needs-permission',
      error: { classification: 'not-authorised' },
    });
  });
});
