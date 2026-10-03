import { describe, expect, it } from 'vitest';
import { ProjectConfigSchema, type ProjectConfig } from '@model/index';
import type { PinData, RawProjectData } from '../../collector/src/collectors/collect';
import { associateSubmodules } from '../../collector/src/normalizers/association';
import type { BuildContext } from '../../collector/src/normalizers/model';
import { resolvePin, toComponents } from '../../collector/src/normalizers/versions';
import { fail, ok } from '../../collector/src/providers/types';
import { NOW, policies, repoData } from '../helpers/factories';

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
