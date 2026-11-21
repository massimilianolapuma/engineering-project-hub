import { describe, expect, it } from 'vitest';
import { ComponentEnvironmentVersionSchema, ProjectConfigSchema } from '@model/index';
import type { RawProjectData } from '../../collector/src/collectors/collect';
import type { ComponentDeploymentRead } from '../../collector/src/collectors/component-deployments';
import type { LedgerRead } from '../../collector/src/collectors/environment-states';
import { componentEnvironmentVersions } from '../../collector/src/normalizers/component-deployments-model';
import type { BuildContext } from '../../collector/src/normalizers/model';
import { toComponents } from '../../collector/src/normalizers/versions';
import { fail, ok, type ProviderResult } from '../../collector/src/providers/types';
import { NOW, policies, repoData } from '../helpers/factories';

/*
 * Component deployments (spec 2026-11-20 §5.3): the snapshot entry of each environment, and the
 * collection errors of the reads that failed.
 */
const SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const DB = 'example-org/db';

const config = ProjectConfigSchema.parse({
  id: 'p',
  name: 'P',
  businessUnit: 'x',
  lifecycle: 'production',
  coordinator: { repository: 'example-org/coord' },
  components: [
    { id: 'db', name: 'DB', repository: DB, type: 'other', deployments: true },
    { id: 'web', name: 'Web', repository: 'example-org/web', type: 'webapp' },
  ],
  environments: [
    { id: 'test', name: 'Test' },
    { id: 'prod', name: 'Prod' },
  ],
  securityControls: Object.fromEntries(
    [
      'codeScanning',
      'secretScanning',
      'dependabot',
      'containerScanning',
      'iacScanning',
      'dast',
      'sbom',
      'artifactSignature',
    ].map((c) => [c, { required: false }]),
  ),
});

const entry = (
  result: ProviderResult<LedgerRead>,
  environmentId = 'test',
  environment = environmentId,
): ComponentDeploymentRead => ({ environmentId, environment, result });

function build(reads: ComponentDeploymentRead[] | null) {
  const raw = {
    config,
    repos: [
      repoData('coord', { componentId: 'coordinator' }),
      repoData('db', { componentId: 'db' }),
      repoData('web', { componentId: 'web' }),
    ],
    manifest: fail({ classification: 'not-found' }),
    gitmodules: ok({ text: '' }),
    submodules: [],
    submoduleRefs: new Map(),
    pins: [],
    componentTags: new Map(),
    workflows: [],
    componentDeployments: reads ? new Map([['db', reads]]) : undefined,
  } as unknown as RawProjectData;
  const ctx: BuildContext = { projectId: 'p', policies: policies(), now: NOW, errors: [] };
  const versions = componentEnvironmentVersions(ctx, raw);
  return { ctx, raw, versions, db: versions.get('db') };
}

const empty = { version: null, ref: null, revision: null, deployedAt: null, declared: false };
const current = (over: Partial<NonNullable<LedgerRead['current']>> = {}) => ({
  version: '0.9.0',
  ref: 'v0.9.0',
  sha: SHA,
  deployedAt: '2026-02-01T10:00:00Z',
  declared: false,
  ...over,
});

describe('componentEnvironmentVersions', () => {
  it('ok: the newest successful deployment, with a short revision', () => {
    const { db } = build([entry(ok({ current: current(), candidates: 3 }), 'svil', 'dev')]);
    expect(db).toEqual([
      {
        environmentId: 'svil',
        environment: 'dev',
        state: 'ok',
        version: '0.9.0',
        ref: 'v0.9.0',
        revision: 'abcdef0',
        deployedAt: '2026-02-01T10:00:00Z',
        declared: false,
      },
    ]);
    for (const e of db!) expect(ComponentEnvironmentVersionSchema.safeParse(e).success).toBe(true);
  });

  it('ok: a branch deployment has no version, a declared record says so', () => {
    const { db } = build([
      entry(ok({ current: current({ version: null, ref: 'main' }), candidates: 1 })),
      entry(ok({ current: current({ declared: true }), candidates: 1 }), 'prod'),
    ]);
    expect(db![0]).toMatchObject({ state: 'ok', version: null, ref: 'main', revision: 'abcdef0' });
    expect(db![1]).toMatchObject({ state: 'ok', version: '0.9.0', declared: true });
  });

  it('none: the environment has no deployment at all', () => {
    const { db, ctx } = build([entry(ok({ current: null, candidates: 0 }))]);
    expect(db).toEqual([{ environmentId: 'test', environment: 'test', state: 'none', ...empty }]);
    expect(ctx.errors).toEqual([]);
  });

  it('no-success: deployments exist, none of the newest succeeded', () => {
    const { db, ctx } = build([entry(ok({ current: null, candidates: 11 }))]);
    expect(db![0]).toEqual({
      environmentId: 'test',
      environment: 'test',
      state: 'no-success',
      ...empty,
    });
    expect(ctx.errors).toEqual([]);
  });

  it('a failed read keeps its reason and never a version', () => {
    const state = (classification: 'not-found' | 'not-authorised' | 'error' | 'rate-limited') =>
      build([entry(fail({ classification }))]).db![0];
    expect(state('not-found')).toEqual({
      environmentId: 'test',
      environment: 'test',
      state: 'not-found',
      ...empty,
    });
    expect(state('not-authorised')!.state).toBe('not-authorised');
    expect(state('error')!.state).toBe('unknown');
    expect(state('rate-limited')!.state).toBe('unknown');
  });

  it('records one deploy-signal error per repository and classification', () => {
    const { ctx } = build([
      entry(fail({ classification: 'not-authorised' })),
      entry(fail({ classification: 'not-authorised' }), 'prod'),
      entry(fail({ classification: 'error' }), 'uat'),
    ]);
    expect(
      ctx.errors.map((e) => [e.repository, e.componentId, e.source, e.classification]),
    ).toEqual([
      [DB, 'db', 'deploy-signal', 'not-authorised'],
      [DB, 'db', 'deploy-signal', 'error'],
    ]);
  });

  it('a component without reads has environmentVersions null', () => {
    const { ctx, raw, versions } = build([entry(ok({ current: current(), candidates: 1 }))]);
    const components = toComponents(ctx, raw, null, [], new Map(), versions);
    expect(components.find((c) => c.id === 'db')!.environmentVersions).toHaveLength(1);
    expect(components.find((c) => c.id === 'web')!.environmentVersions).toBeNull();
    const none = build(null);
    expect(none.versions.size).toBe(0);
    expect(
      toComponents(none.ctx, none.raw, null, [], new Map(), none.versions).every(
        (c) => c.environmentVersions === null,
      ),
    ).toBe(true);
  });
});
