import { describe, expect, it } from 'vitest';
import { ProjectConfigSchema, type ProjectConfig } from '@model/index';
import type { PinData, RawProjectData } from '../../collector/src/collectors/collect';
import { associateSubmodules } from '../../collector/src/normalizers/association';
import type { BuildContext } from '../../collector/src/normalizers/model';
import { resolvePin, toComponents, toEnvironments } from '../../collector/src/normalizers/versions';
import { fail, ok, type ProviderResult } from '../../collector/src/providers/types';
import { NOW, policies, repoData } from '../helpers/factories';
import type { ArgoApplicationDTO } from '../../collector/src/providers/external/types';
import type { ReleaseManifest } from '@model/index';

const SHA = 'a'.repeat(40);
const project = (versionSource = 'auto'): ProjectConfig =>
  ProjectConfigSchema.parse({
    id: 'p',
    name: 'P',
    businessUnit: 'x',
    lifecycle: 'production',
    coordinator: { repository: 'example-org/coord' },
    components: [
      {
        id: 'api',
        name: 'API',
        repository: 'example-org/api',
        type: 'service',
        submodulePath: 'services/api',
        versionSource,
      },
      { id: 'web', name: 'Web', repository: 'example-org/web', type: 'webapp' },
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

const submodule = {
  path: 'services/api',
  repository: 'example-org/api',
  sha: SHA,
  componentId: 'api',
  association: 'configured-path' as const,
  status: 'resolved' as const,
};

function raw(
  config: ProjectConfig,
  pin: Partial<PinData> | null,
): { raw: RawProjectData; ctx: BuildContext } {
  const pins: PinData[] = pin
    ? [{ componentId: 'api', sha: SHA, tags: ok([]), compareBase: null, compare: null, ...pin }]
    : [];
  const release = ok({
    tagName: 'v3.2.0',
    name: 'v3.2.0',
    publishedAt: NOW.toISOString(),
    prerelease: false,
    htmlUrl: 'https://github.com/example-org/api/releases/tag/v3.2.0',
    assets: [],
  });
  return {
    raw: {
      config,
      repos: [
        repoData('coord', { componentId: 'coordinator' }),
        repoData('api', { componentId: 'api', release }),
        repoData('web', { componentId: 'web' }),
      ],
      manifest: fail({ classification: 'not-found' }),
      gitmodules: ok({ text: '' }),
      submodules: [],
      submoduleRefs: new Map(),
      pins,
      componentTags: new Map(),
      workflows: [],
    },
    ctx: { projectId: 'p', policies: policies(), now: NOW, errors: [] },
  };
}
const manifest = (api: string) => ({
  schemaVersion: '1.0' as const,
  version: '3.2.0',
  components: { api: { version: api } },
  environments: {},
});

describe('submodule association', () => {
  it('links by configured path, then by remote URL, never by name', () => {
    const cfg = project();
    const entries = [
      {
        name: 'a',
        path: 'services/api',
        url: 'https://github.com/other/whatever.git',
        branch: null,
      },
      { name: 'b', path: 'apps/web', url: 'git@github.com:example-org/web.git', branch: null },
      {
        name: 'c',
        path: 'tools/web-tools',
        url: 'https://github.com/example-org/web-tools.git',
        branch: null,
      },
    ];
    expect(
      associateSubmodules(cfg, entries).map((a) => [
        a.entry.path,
        a.component?.id ?? null,
        a.association,
      ]),
    ).toEqual([
      ['services/api', 'api', 'configured-path'],
      ['apps/web', 'web', 'repository-url'],
      ['tools/web-tools', null, 'unmapped'],
    ]);
  });
});

describe('pin resolution (submodule SHA → version)', () => {
  const cfg = project();
  const comp = cfg.components[0]!;
  it('finds the tag on the pinned SHA, preferring the highest version', () => {
    const { raw: r } = raw(cfg, {
      tags: ok([
        { name: 'v3.1.0', sha: SHA },
        { name: 'v3.1.0-rc.1', sha: SHA },
        { name: 'v3.2.0', sha: 'b'.repeat(40) },
      ]),
    });
    expect(resolvePin(r, comp, submodule)).toMatchObject({
      status: 'tagged',
      tag: 'v3.1.0',
      version: '3.1.0',
    });
  });
  it('reports the distance from the latest release when the SHA is not tagged', () => {
    const { raw: r } = raw(cfg, {
      compareBase: 'v3.2.0',
      compare: ok({ status: 'ahead', aheadBy: 4, behindBy: 0 }),
    });
    expect(resolvePin(r, comp, submodule)).toEqual({
      status: 'ahead',
      tag: null,
      version: null,
      comparedTo: 'v3.2.0',
      aheadBy: 4,
      behindBy: 0,
    });
  });
  it('is unknown when tags cannot be read, and null for non-submodule components', () => {
    const { raw: r } = raw(cfg, {
      tags: fail({ classification: 'not-authorised', httpStatus: 403 }),
    });
    expect(resolvePin(r, comp, submodule)?.status).toBe('unknown');
    expect(resolvePin(r, cfg.components[1]!, null)).toBeNull();
  });
});

describe('versionSource', () => {
  const tagged = { tags: ok([{ name: 'v3.1.0', sha: SHA }]) };
  const run = (source: string, pin: Partial<PinData> | null, declared?: string) => {
    const { raw: r, ctx } = raw(project(source), pin);
    return toComponents(ctx, r, declared ? manifest(declared) : null, [submodule])[0]!;
  };
  it('auto prefers the verified pin, then the manifest', () => {
    expect(run('auto', tagged, '3.2.0')).toMatchObject({
      effectiveVersion: '3.1.0',
      effectiveVersionSource: 'submodule',
      drift: 'drift',
      manifestConsistency: 'mismatch',
    });
    expect(
      run(
        'auto',
        { compareBase: 'v3.2.0', compare: ok({ status: 'ahead', aheadBy: 1, behindBy: 0 }) },
        '3.2.0',
      ),
    ).toMatchObject({
      effectiveVersion: '3.2.0',
      effectiveVersionSource: 'manifest',
      drift: 'aligned',
    });
  });
  it('manifest / release / submodule use only their own source', () => {
    expect(run('manifest', tagged, '3.2.0')).toMatchObject({
      effectiveVersion: '3.2.0',
      effectiveVersionSource: 'manifest',
    });
    expect(run('release', tagged)).toMatchObject({
      effectiveVersion: '3.2.0',
      effectiveVersionSource: 'release',
      drift: 'aligned',
    });
    expect(run('submodule', { tags: ok([]) }, '3.2.0')).toMatchObject({
      effectiveVersion: null,
      effectiveVersionSource: 'unknown',
      drift: 'unknown',
    });
  });
  it('marks manifest and pin as consistent when equal', () => {
    expect(run('auto', tagged, '3.1.0').manifestConsistency).toBe('consistent');
  });
});

describe('toEnvironments with Argo CD (spec 5.9)', () => {
  const config = ProjectConfigSchema.parse({
    id: 'p',
    name: 'P',
    businessUnit: 'x',
    lifecycle: 'production',
    coordinator: { repository: 'example-org/coord' },
    components: [
      {
        id: 'backend',
        name: 'Backend',
        repository: 'example-org/backend',
        type: 'service',
        containerImages: [{ project: 'alpha', repository: 'backend' }],
      },
      {
        id: 'frontend',
        name: 'Frontend',
        repository: 'example-org/frontend',
        type: 'webapp',
        containerImages: [{ project: 'alpha', repository: 'frontend' }],
      },
    ],
    environments: [
      { id: 'dev', name: 'DEV', argocdApplication: { name: 'alpha-dev', namespace: 'argocd' } },
      { id: 'prod', name: 'PROD' },
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
  const manifest = (versions: Record<string, string>): ReleaseManifest =>
    ({
      schemaVersion: '1.0',
      components: {},
      environments: Object.fromEntries(
        Object.entries(versions).map(([k, version]) => [k, { version }]),
      ),
    }) as unknown as ReleaseManifest;
  const dto = (over: Partial<ArgoApplicationDTO> = {}): ArgoApplicationDTO => ({
    sync: 'synced',
    health: 'healthy',
    revision: 'f'.repeat(40),
    targetRevision: 'v1.4.0',
    images: [],
    deployedAt: '2026-01-13T12:00:00.000Z',
    ...over,
  });
  const images = [
    { componentId: 'backend', path: 'alpha/backend' },
    { componentId: 'frontend', path: 'alpha/frontend' },
  ];
  const env = (
    result: ProviderResult<ArgoApplicationDTO>,
    versions: Record<string, string> = { dev: '1.4.0' },
    tags: { name: string; sha: string }[] = [],
    imageMap = images,
  ) =>
    toEnvironments(
      config,
      manifest(versions),
      '1.4.0',
      new Map([['dev', result]]),
      tags as never,
      imageMap,
    )[0]!;

  it('targetRevision v1.4.0 → version 1.4.0, source argocd, aligned vs coordinator 1.4.0', () => {
    expect(env(ok(dto()))).toMatchObject({
      version: '1.4.0',
      declaredVersion: '1.4.0',
      source: 'argocd',
      status: 'aligned',
      deployment: { state: 'available', sync: 'synced', health: 'healthy', version: '1.4.0' },
    });
  });

  it('targetRevision HEAD + unknown revision → version = declared 1.4.0, source manifest, deployment.version null', () => {
    const e = env(ok(dto({ targetRevision: 'HEAD', revision: '0'.repeat(40) })));
    expect(e).toMatchObject({
      version: '1.4.0',
      source: 'manifest',
      deployment: { version: null, sync: 'synced' },
    });
  });

  it('revision equal to the v3.1.0 tag SHA resolves to 3.1.0', () => {
    const sha = 'c'.repeat(40);
    const e = env(ok(dto({ targetRevision: 'main', revision: sha })), { dev: '1.4.0' }, [
      { name: 'v3.1.0', sha },
    ]);
    expect(e).toMatchObject({ version: '3.1.0', source: 'argocd', status: 'mismatch' });
    expect(e.deployment!.version).toBe('3.1.0');
  });

  it('403 → deployment.state not-authorised, version from the manifest', () => {
    const e = env(fail({ classification: 'not-authorised', httpStatus: 403 }), { dev: '3.2.0' });
    expect(e).toMatchObject({
      version: '3.2.0',
      source: 'manifest',
      deployment: { state: 'not-authorised', sync: null, health: null, images: [] },
    });
    expect(env(fail({ classification: 'not-found' })).deployment!.state).toBe('not-found');
    expect(env(fail({ classification: 'error' })).deployment!.state).toBe('unknown');
  });

  it('argocd off or not mapped → deployment null, behaviour identical to v0.9.0', () => {
    const off = toEnvironments(
      config,
      manifest({ dev: '1.4.0', prod: '1.3.0' }),
      '1.4.0',
      new Map([['dev', 'off']]),
    );
    expect(off.map((e) => e.deployment)).toEqual([null, null]);
    // prod has no mapped application even if a result is somehow present
    const unmapped = toEnvironments(
      config,
      manifest({ prod: '1.3.0' }),
      '1.4.0',
      new Map([['prod', ok(dto())]]),
    );
    expect(unmapped[1]).toMatchObject({ source: 'manifest', status: 'behind', deployment: null });
    expect(unmapped[0]).toMatchObject({ version: null, source: 'unknown', declaredVersion: null });
  });

  it('images: harbor.example.invalid/alpha/backend:1.4.0 → backend 1.4.0; registry.internal.example/canary-img-4d2e:1.0 dropped', () => {
    const e = env(
      ok(
        dto({
          images: [
            'harbor.example.invalid/alpha/backend:1.4.0',
            'harbor.example.invalid:5000/alpha/frontend:2.1.0@sha256:' + 'a'.repeat(64),
            'registry.internal.example/canary-img-4d2e:1.0',
            'alpha/other:9',
          ],
        }),
      ),
    );
    expect(e.deployment!.images).toEqual([
      { componentId: 'backend', version: '1.4.0' },
      { componentId: 'frontend', version: '2.1.0' },
    ]);
    expect(JSON.stringify(e)).not.toContain('canary');
  });

  it('an image without a tag has no version; at most 20 images are published', () => {
    const e = env(ok(dto({ images: ['alpha/backend'] })));
    expect(e.deployment!.images).toEqual([{ componentId: 'backend', version: null }]);
    const many = env(ok(dto({ images: Array.from({ length: 50 }, () => 'alpha/backend:1.0.0') })));
    expect(many.deployment!.images).toHaveLength(20);
  });

  it('revision published as 7 characters; without a revision a version-like targetRevision', () => {
    expect(env(ok(dto())).deployment!.revision).toBe('fffffff');
    expect(env(ok(dto({ revision: null }))).deployment!.revision).toBe('v1.4.0');
    expect(
      env(ok(dto({ revision: null, targetRevision: 'HEAD' }))).deployment!.revision,
    ).toBeNull();
  });

  it('deployedAt is kept; a deployed version behind the coordinator is behind', () => {
    const e = env(ok(dto({ targetRevision: 'v1.3.0' })));
    expect(e).toMatchObject({ version: '1.3.0', status: 'behind' });
    expect(e.deployment!.deployedAt).toBe('2026-01-13T12:00:00.000Z');
  });
});
