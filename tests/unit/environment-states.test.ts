import { describe, expect, it } from 'vitest';
import type { EnvironmentSnapshot, ProjectConfig } from '@model/index';
import {
  MAX_STATUS_READS,
  readEnvironmentState,
  type EnvironmentState,
} from '../../collector/src/collectors/environment-states';
import { toEnvironments } from '../../collector/src/normalizers/versions';
import { fail, ok, type SourceProvider } from '../../collector/src/providers/types';
import { branchDeployment } from '../../src/lib/env-version';

/*
 * Environment versions from deploy signals (snapshot 1.10): the versions file declares what an
 * environment should run, the GitHub deployments ledger says what was deployed last.
 */

const SHA = 'a'.repeat(40);
const config = {
  id: 'p',
  coordinator: { repository: 'example-org/coord', defaultBranch: 'main' },
  components: [{ id: 'infra', repository: 'example-org/infra' }],
  environments: [],
} as unknown as ProjectConfig;

type Env = ProjectConfig['environments'][number];
const env = (id: string, deploySignal: Env['deploySignal'], extra: Partial<Env> = {}): Env =>
  ({ id, name: id.toUpperCase(), deploySignal, ...extra }) as Env;

const versionsFile = (path: string): Env['deploySignal'] => ({
  type: 'versions-file',
  repository: 'coordinator',
  path,
  key: 'umbrella',
  tagPrefix: 'v',
});
const ledgerSignal = (extra: object = {}): Env['deploySignal'] =>
  ({
    type: 'github-deployments',
    repository: 'coordinator',
    tagPrefix: 'v',
    ...extra,
  }) as Env['deploySignal'];

describe('readEnvironmentState — versions file', () => {
  const provider = (text: string | null) =>
    ({
      getFile: async (_r: string, _p: string, ref?: string) => {
        expect(ref).toBeUndefined(); // the default branch
        return text === null ? fail({ classification: 'not-found' as const }) : ok({ text });
      },
    }) as unknown as SourceProvider;

  it('declares the semver at the key on the default branch', async () => {
    const s = await readEnvironmentState(
      provider('# promoted by promote.yml\numbrella: 0.11.3\n'),
      config,
      env('prod', versionsFile('environments/prod.yaml')),
    );
    expect(s).toEqual({ repository: 'example-org/coord', declared: ok('0.11.3') });
  });

  it('declares nothing for a non-semver value, and keeps a missing file as an error', async () => {
    const latest = await readEnvironmentState(
      provider('umbrella: latest\n'),
      config,
      env('dev', versionsFile('environments/dev.yaml')),
    );
    expect(latest?.declared).toEqual(ok(null));
    const missing = await readEnvironmentState(
      provider(null),
      config,
      env('dev', versionsFile('environments/dev.yaml')),
    );
    expect(missing?.declared?.ok).toBe(false);
  });

  it('does not call an unreadable repository again', async () => {
    const s = await readEnvironmentState(
      provider('umbrella: 1.0.0'),
      config,
      env('dev', versionsFile('environments/dev.yaml')),
      () => true,
    );
    expect(s).toBeNull();
  });
});

describe('readEnvironmentState — GitHub deployments', () => {
  const deployments = [
    {
      id: 1,
      sha: SHA,
      ref: 'main',
      environment: 'lab',
      createdAt: '2026-03-01T10:00:00Z',
      payload: '',
    },
    {
      id: 2,
      sha: SHA,
      ref: 'main',
      environment: 'lab',
      createdAt: '2026-03-02T10:00:00Z',
      payload: '',
    },
    {
      id: 3,
      sha: SHA,
      ref: 'v1.2.0',
      environment: 'lab',
      createdAt: '2026-02-01T10:00:00Z',
      payload: '',
    },
  ];
  const statuses: Record<number, { state: string; createdAt: string }[]> = {
    1: [{ state: 'success', createdAt: '2026-03-01T10:05:00Z' }],
    2: [{ state: 'failure', createdAt: '2026-03-02T10:05:00Z' }],
    3: [{ state: 'success', createdAt: '2026-02-01T10:05:00Z' }],
  };
  const provider = (list = deployments, seen: string[] = []) =>
    ({
      listDeployments: async (repo: string, environment: string) => {
        seen.push(`${repo}:${environment}`);
        return ok(list);
      },
      listDeploymentStatuses: async (_r: string, id: number) => ok(statuses[id] ?? []),
    }) as unknown as SourceProvider;

  it('takes the newest successful deployment: a branch has no version', async () => {
    const seen: string[] = [];
    const s = await readEnvironmentState(
      provider(deployments, seen),
      config,
      env('lab', ledgerSignal()),
    );
    expect(seen).toEqual(['example-org/coord:lab']);
    expect(s?.ledger).toEqual(
      ok({ version: null, ref: 'main', sha: SHA, deployedAt: '2026-03-01T10:05:00Z' }),
    );
  });

  it('reads the version from a tag ref, and the ledger payload first', async () => {
    const tag = await readEnvironmentState(
      provider([deployments[2]!]),
      config,
      env('lab', ledgerSignal()),
    );
    expect(tag?.ledger?.ok && tag.ledger.data?.version).toBe('1.2.0');
    const payload = JSON.stringify({
      ledger: 1,
      source: 'azure-devops',
      runId: '7',
      runUrl: 'https://dev.example.com/run/7',
      version: '2.0.0',
      finishedAt: '2026-03-01T11:00:00Z',
    });
    const s = await readEnvironmentState(
      provider([{ ...deployments[0]!, payload }]),
      config,
      env('lab', ledgerSignal()),
    );
    expect(s?.ledger).toEqual(
      ok({ version: '2.0.0', ref: 'main', sha: SHA, deployedAt: '2026-03-01T11:00:00Z' }),
    );
  });

  it('uses the GitHub environment name and the sources filter', async () => {
    const seen: string[] = [];
    const s = await readEnvironmentState(
      provider(deployments, seen),
      config,
      env('prod', ledgerSignal({ sources: ['azure-devops'] }), { githubEnvironment: 'production' }),
    );
    expect(seen).toEqual(['example-org/coord:production']);
    expect(s?.ledger).toEqual(ok(null)); // Actions deployments are filtered out
  });

  it('reads at most a bounded number of statuses, and keeps errors', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...deployments[1]!, id: 100 + i }));
    let reads = 0;
    const p = {
      listDeployments: async () => ok(many),
      listDeploymentStatuses: async () => {
        reads++;
        return ok([{ state: 'failure', createdAt: '2026-03-02T10:05:00Z' }]);
      },
    } as unknown as SourceProvider;
    expect((await readEnvironmentState(p, config, env('lab', ledgerSignal())))?.ledger).toEqual(
      ok(null),
    );
    expect(reads).toBe(MAX_STATUS_READS);
    const denied = {
      listDeployments: async () => fail({ classification: 'not-authorised' as const }),
      listDeploymentStatuses: async () => ok([]),
    } as unknown as SourceProvider;
    const s = await readEnvironmentState(denied, config, env('lab', ledgerSignal()));
    expect(s?.ledger?.ok).toBe(false);
  });

  it('ignores the other signals', async () => {
    expect(
      await readEnvironmentState(provider(), config, env('x', { type: 'external' })),
    ).toBeNull();
  });
});

describe('toEnvironments with signal states', () => {
  const project = {
    ...config,
    environments: [
      env('lab', ledgerSignal()),
      env('svil', versionsFile('environments/dev.yaml')),
      env('prod', versionsFile('environments/prod.yaml')),
    ],
  } as ProjectConfig;
  const states = new Map<string, EnvironmentState>([
    [
      'lab',
      {
        repository: 'example-org/coord',
        ledger: ok({ version: null, ref: 'main', sha: SHA, deployedAt: '2026-03-01T10:05:00Z' }),
      },
    ],
    ['svil', { repository: 'example-org/coord', declared: ok('0.11.8') }],
    ['prod', { repository: 'example-org/coord', declared: ok('0.11.3') }],
  ]);

  it('declares from the versions file and shows the branch deployment', () => {
    const [lab, svil, prod] = toEnvironments(project, null, '0.11.8', new Map(), [], [], states);
    expect(svil).toMatchObject({ version: '0.11.8', source: 'versions-file', status: 'aligned' });
    expect(prod).toMatchObject({ version: '0.11.3', source: 'versions-file', status: 'behind' });
    expect(svil!.deployment).toBeNull();
    expect(lab).toMatchObject({ version: null, source: 'github-deployments', status: 'unknown' });
    expect(lab!.deployment).toEqual({
      kind: 'github-deployments',
      state: 'available',
      sync: null,
      health: null,
      revision: 'aaaaaaa',
      ref: 'main',
      version: null,
      deployedAt: '2026-03-01T10:05:00Z',
      images: [],
    });
    expect(branchDeployment(lab!)).toEqual({ ref: 'main', sha: 'aaaaaaa' });
    expect(branchDeployment(svil!)).toBeNull();
  });

  it('prefers the manifest over the versions file, and a deployed version over both', () => {
    const manifest = {
      schemaVersion: '1.0' as const,
      version: '0.11.8',
      components: {},
      environments: { prod: { version: '0.11.2' }, lab: { version: '0.11.0' } },
    };
    const withVersion = new Map(states);
    withVersion.set('lab', {
      repository: 'example-org/coord',
      ledger: ok({
        version: '0.11.8',
        ref: 'v0.11.8',
        sha: SHA,
        deployedAt: '2026-03-01T10:05:00Z',
      }),
    });
    const [lab, , prod] = toEnvironments(
      project,
      manifest,
      '0.11.8',
      new Map(),
      [],
      [],
      withVersion,
    );
    expect(prod).toMatchObject({
      version: '0.11.2',
      declaredVersion: '0.11.2',
      source: 'manifest',
    });
    expect(lab).toMatchObject({
      version: '0.11.8',
      declaredVersion: '0.11.0',
      source: 'github-deployments',
      status: 'aligned',
    });
    expect(branchDeployment(lab!)).toBeNull();
  });

  it('shows an unreadable ledger as unknown, never as no deployment', () => {
    const denied = new Map<string, EnvironmentState>([
      [
        'lab',
        { repository: 'example-org/coord', ledger: fail({ classification: 'not-authorised' }) },
      ],
    ]);
    const [lab] = toEnvironments(project, null, '0.11.8', new Map(), [], [], denied);
    expect(lab).toMatchObject({ version: null, source: 'unknown', status: 'unknown' });
    expect(lab!.deployment).toMatchObject({ kind: 'github-deployments', state: 'not-authorised' });
    expect(branchDeployment(lab as EnvironmentSnapshot)).toBeNull();
  });
});
