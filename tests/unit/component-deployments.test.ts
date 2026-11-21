import { describe, expect, it } from 'vitest';
import { collectComponentDeployments } from '../../collector/src/collectors/component-deployments';
import type { CollectContext, RawProjectData } from '../../collector/src/collectors/collect';
import {
  fail,
  ok,
  type DeploymentDTO,
  type DeploymentStatusDTO,
  type ProviderResult,
  type SourceProvider,
} from '../../collector/src/providers/types';

/*
 * Component deployments (spec 2026-11-20 §5.2): for a component marked `deployments: true`, the
 * GitHub Deployments of its own repository, once per project environment.
 */
const SHA = 'a'.repeat(40);
const DB = 'example-org/alpha-db';

const ledger = (extra: Record<string, unknown> = {}) => ({
  ledger: 1,
  source: 'azure-devops',
  runId: '7',
  runUrl: 'https://dev.azure.com/example-org/example-project/_build/results?buildId=7',
  attempt: 1,
  finishedAt: '2026-02-01T10:00:00Z',
  ...extra,
});
const dep = (id: number, over: Partial<DeploymentDTO> = {}): DeploymentDTO => ({
  id,
  sha: SHA,
  environment: 'test',
  createdAt: `2026-02-${String(id).padStart(2, '0')}T10:00:00Z`,
  payload: {},
  creator: 'example-app[bot]',
  ...over,
});
const st = (state: string): DeploymentStatusDTO[] => [{ state, createdAt: '2026-02-20T10:00:00Z' }];

interface Options {
  environments?: Record<string, unknown>[];
  components?: Record<string, unknown>[];
  /** Deployments by "<repository>|<environment name>". */
  deployments?: Record<string, DeploymentDTO[] | ProviderResult<DeploymentDTO[]>>;
  statuses?: Record<number, DeploymentStatusDTO[]>;
  /** Umbrella chart on main: YAML text, or a failed read. */
  chart?: string | 'failed';
}

function setup(o: Options = {}) {
  const calls: Array<[string, string]> = [];
  const provider = {
    listDeployments: async (repo: string, environment: string) => {
      calls.push([repo, environment]);
      const hit = o.deployments?.[`${repo}|${environment}`];
      return Array.isArray(hit) ? ok(hit) : (hit ?? ok([]));
    },
    listDeploymentStatuses: async (_r: string, id: number) => ok(o.statuses?.[id] ?? []),
  } as unknown as SourceProvider;
  const ctx = {
    provider,
    limit: <T>(t: () => Promise<T>) => t(),
    cache: new Map(),
  } as unknown as CollectContext;
  const components = o.components ?? [
    { id: 'db', name: 'DB', repository: DB, type: 'other', deployments: true },
  ];
  const raw = {
    config: {
      id: 'p',
      coordinator: {
        repository: 'example-org/coord',
        defaultBranch: 'main',
        umbrellaChart: o.chart ? { path: 'Chart.yaml', tagPrefix: 'v' } : undefined,
      },
      components,
      environments: o.environments ?? [
        { id: 'test', name: 'TEST', deploySignal: { type: 'external' } },
        { id: 'prod', name: 'PROD', deploySignal: { type: 'external' } },
      ],
    },
    repos: [
      { repository: 'example-org/coord', repo: ok({}) },
      ...components.map((c) => ({
        repository: c.repository,
        componentId: c.id,
        repo: ok({}),
      })),
    ],
    umbrella: o.chart
      ? {
          main:
            o.chart === 'failed'
              ? fail({ classification: 'not-authorised' })
              : ok({ text: o.chart }),
          release: null,
          environments: new Map(),
        }
      : undefined,
  } as unknown as RawProjectData;
  return { ctx, raw, calls };
}

const read = async (o: Options) => {
  const s = setup(o);
  await collectComponentDeployments(s.ctx, [s.raw]);
  return { ...s, reads: s.raw.componentDeployments?.get('db') };
};
const current = (r: Awaited<ReturnType<typeof read>>, i = 0) => {
  const result = r.reads![i]!.result;
  if (!result.ok) throw new Error('expected an ok read');
  return result.data;
};

describe('collectComponentDeployments', () => {
  it('reads one result per project environment for a flagged component', async () => {
    const r = await read({});
    expect(r.reads!.map((e) => [e.environmentId, e.environment])).toEqual([
      ['test', 'test'],
      ['prod', 'prod'],
    ]);
    expect(r.calls).toEqual([
      [DB, 'test'],
      [DB, 'prod'],
    ]);
  });

  it('asks GitHub for githubEnvironment when it differs from the id', async () => {
    const r = await read({
      environments: [
        { id: 'svil', name: 'SVIL', githubEnvironment: 'dev', deploySignal: { type: 'external' } },
      ],
    });
    expect(r.calls).toEqual([[DB, 'dev']]);
    expect(r.reads![0]).toMatchObject({ environmentId: 'svil', environment: 'dev' });
  });

  it('ignores the environment and sources of the project deploy signal', async () => {
    const r = await read({
      environments: [
        {
          id: 'prod',
          name: 'PROD',
          deploySignal: {
            type: 'github-deployments',
            repository: 'coordinator',
            environment: 'production',
            sources: ['azure-devops'],
            tagPrefix: 'v',
          },
        },
      ],
      // Written by a GitHub Actions job: no ledger payload.
      deployments: { [`${DB}|prod`]: [dep(1, { ref: 'v1.2.0' })] },
      statuses: { 1: st('success') },
    });
    expect(r.calls).toEqual([[DB, 'prod']]);
    expect(current(r)).toMatchObject({ candidates: 1, current: { version: '1.2.0' } });
  });

  it('takes the version from the payload, else from the tag with the component prefix', async () => {
    const component = {
      id: 'db',
      name: 'DB',
      repository: DB,
      type: 'other',
      deployments: true,
      releaseTagPrefix: 'db-v',
    };
    const one = (d: DeploymentDTO) =>
      read({
        components: [component],
        deployments: { [`${DB}|test`]: [d] },
        statuses: { 1: st('success') },
      });
    const payload = await one(dep(1, { ref: 'db-v0.8.0', payload: ledger({ version: '0.9.0' }) }));
    expect(current(payload).current).toMatchObject({ version: '0.9.0', ref: 'db-v0.8.0' });
    const tag = await one(dep(1, { ref: 'db-v0.9.0' }));
    expect(current(tag).current).toMatchObject({ version: '0.9.0', ref: 'db-v0.9.0' });
    const branch = await one(dep(1, { ref: 'main' }));
    expect(current(branch).current).toMatchObject({ version: null, ref: 'main', sha: SHA });
  });

  it('keeps the newest successful deployment when a newer one failed', async () => {
    const r = await read({
      deployments: {
        [`${DB}|test`]: [
          dep(2, { payload: ledger({ runId: '2', version: '0.9.0' }) }),
          dep(1, {
            payload: ledger({ runId: '1', version: '0.8.0', finishedAt: '2026-01-15T10:00:00Z' }),
          }),
        ],
      },
      statuses: { 2: st('failure'), 1: st('success') },
    });
    expect(current(r)).toMatchObject({ candidates: 2, current: { version: '0.8.0' } });
  });

  it('reports candidates without a current when the 10 newest have no success', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => dep(i + 1));
    const r = await read({
      deployments: { [`${DB}|test`]: eleven },
      statuses: Object.fromEntries(eleven.map((d) => [d.id, st('failure')])),
    });
    expect(current(r)).toEqual({ current: null, candidates: 11 });
  });

  it('an environment with no deployment gives current null and candidates 0', async () => {
    const r = await read({});
    expect(current(r)).toEqual({ current: null, candidates: 0 });
  });

  it('carries declared: true from a hand-declared record', async () => {
    const r = await read({
      deployments: {
        [`${DB}|test`]: [
          dep(1, { payload: ledger({ source: 'manual', declared: true, version: '0.8.0' }) }),
        ],
        [`${DB}|prod`]: [dep(2, { environment: 'prod', payload: ledger({ version: '0.8.0' }) })],
      },
      statuses: { 1: st('success'), 2: st('success') },
    });
    expect(current(r, 0).current).toMatchObject({ declared: true, version: '0.8.0' });
    expect(current(r, 1).current).toMatchObject({ declared: false });
  });

  const chart = `apiVersion: v2
name: umbrella
version: 1.0.0
dependencies:
  - name: alpha-db
    version: 0.9.0
    repository: oci://registry.example/charts
`;

  it('does not read a component that the umbrella chart on main contains', async () => {
    const r = await read({ chart });
    expect(r.calls).toEqual([]);
    expect(r.reads).toBeUndefined();
  });

  it('reads it when the main chart could not be read', async () => {
    const r = await read({ chart: 'failed' });
    expect(r.calls).toHaveLength(2);
    expect(r.reads).toHaveLength(2);
  });

  it('makes no call for a project without flagged components', async () => {
    const s = setup({
      components: [{ id: 'db', name: 'DB', repository: DB, type: 'other' }],
    });
    await collectComponentDeployments(s.ctx, [s.raw]);
    expect(s.calls).toEqual([]);
    expect(s.raw.componentDeployments).toBeUndefined();
  });

  it('a failed list is kept as the failed result', async () => {
    const r = await read({
      deployments: { [`${DB}|test`]: fail({ classification: 'not-authorised' }) },
    });
    const result = r.reads![0]!.result;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.classification).toBe('not-authorised');
  });

  it('skips a component whose repository could not be read', async () => {
    const s = setup({});
    s.raw.repos[1]!.repo = fail({ classification: 'not-found' });
    await collectComponentDeployments(s.ctx, [s.raw]);
    expect(s.calls).toEqual([]);
  });
});
