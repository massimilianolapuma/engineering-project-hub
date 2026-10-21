import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  collectReusableTargets,
  collectRepository,
  MAX_REFERENCED_REPOSITORIES,
  type CollectContext,
} from '../../collector/src/collectors/collect';
import { fail, ok, type SourceProvider } from '../../collector/src/providers/types';
import { createLimiter } from '../../collector/src/util/concurrency';
import { policies, repoDto } from '../helpers/factories';

const A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const NOT_FOUND = fail({ classification: 'not-found', httpStatus: 404 });

function stub(overrides: Partial<Record<keyof SourceProvider, unknown>> = {}) {
  const provider = {
    dataSource: 'mock',
    authenticationMode: 'mock',
    getRepository: vi.fn(async (repo: string) => ok(repoDto(repo.split('/')[1]!))),
    getBranchHead: vi.fn(async () => ok({ sha: A, htmlUrl: null, committedAt: null })),
    getLatestRelease: vi.fn(async () => NOT_FOUND),
    getLatestTag: vi.fn(async () => NOT_FOUND),
    listTags: vi.fn(async () => ok([])),
    getFile: vi.fn(async () => ok({ text: 'jobs: {}' })),
    listDirectory: vi.fn(async () => NOT_FOUND),
    listCodeScanningAlerts: vi.fn(async () => ok([])),
    getLatestCodeScanningAnalysis: vi.fn(async () => ok(null)),
    getLatestScorecardAnalysis: vi.fn(async () => ok(null)),
    listDependabotAlerts: vi.fn(async () => ok([])),
    listSecretScanningAlerts: vi.fn(async () => ok([])),
    getQualitySummary: vi.fn(async () => NOT_FOUND),
    listCodeQualityFindings: vi.fn(async () => ok([])),
    getBranchRules: vi.fn(async () => ok([])),
    getClassicBranchProtection: vi.fn(async () => ok(null)),
    ...overrides,
  };
  return provider;
}
const context = (
  provider: ReturnType<typeof stub>,
  tweak: (p: ReturnType<typeof policies>) => void = () => {},
): CollectContext => ({
  provider: provider as unknown as SourceProvider,
  limit: createLimiter(4),
  cache: new Map(),
  policies: policies(tweak),
});
const collect = (ctx: CollectContext) =>
  collectRepository(ctx, 'coordinator', 'example-org/svc', null, '.security/status.json');

describe('repository controls collection', () => {
  it('reads only plain workflow files, sorted, at most maxWorkflowFiles, and counts the rest', async () => {
    const provider = stub({
      listDirectory: vi.fn(async () =>
        ok([
          { name: 'z.yml', type: 'file' },
          { name: 'b.yaml', type: 'file' },
          { name: 'a.yml', type: 'file' },
          { name: 'README.md', type: 'file' },
          { name: 'sub', type: 'dir' },
          { name: 'c d.yml', type: 'file' },
          { name: 'link.yml', type: 'symlink' },
        ]),
      ),
    });
    const ctx = context(provider, (p) => {
      p.repositoryControls.maxWorkflowFiles = 2;
    });
    const data = await collect(ctx);
    expect([...data.controls!.workflowFiles.keys()].sort()).toEqual(['a.yml', 'b.yaml']);
    expect(data.controls!.omittedFiles).toBe(1);
    expect(provider.getFile).toHaveBeenCalledWith(
      'example-org/svc',
      '.github/workflows/a.yml',
      'main',
    );
    expect(provider.listDirectory).toHaveBeenCalledWith(
      'example-org/svc',
      '.github/workflows',
      'main',
    );
  });

  it('a 404 on the directory reads no files and makes no file call', async () => {
    const provider = stub();
    const data = await collect(context(provider));
    expect(data.controls!.workflowDir.ok).toBe(false);
    expect(data.controls!.workflowFiles.size).toBe(0);
    expect((provider.getFile as Mock).mock.calls.map((c) => c[1])).not.toContainEqual(
      expect.stringContaining('.github/workflows'),
    );
  });

  it('never calls the classic protection endpoint unless readClassicProtection is on', async () => {
    const off = stub();
    const dataOff = await collect(context(off));
    expect(off.getClassicBranchProtection).not.toHaveBeenCalled();
    expect(dataOff.controls!.classic).toBeNull();
    const on = stub();
    const dataOn = await collect(
      context(on, (p) => {
        p.repositoryControls.readClassicProtection = true;
      }),
    );
    expect(on.getClassicBranchProtection).toHaveBeenCalledTimes(1);
    expect(dataOn.controls!.classic).toEqual(ok(null));
  });

  it('makes none of the calls when the block is disabled', async () => {
    const provider = stub();
    const data = await collect(
      context(provider, (p) => {
        p.repositoryControls.enabled = false;
      }),
    );
    expect(data.controls).toBeNull();
    for (const name of [
      'getBranchRules',
      'getClassicBranchProtection',
      'getLatestScorecardAnalysis',
    ] as const)
      expect(provider[name], name).not.toHaveBeenCalled();
    expect(provider.listDirectory).not.toHaveBeenCalled();
  });

  it('memoises calls shared with other targets of the same repository', async () => {
    const provider = stub();
    const ctx = context(provider);
    await collect(ctx);
    await collectRepository(ctx, 'web', 'example-org/svc', null, '.security/status.json');
    expect(provider.getBranchRules).toHaveBeenCalledTimes(1);
    expect(provider.listDirectory).toHaveBeenCalledTimes(1);
  });
});

describe('collectReusableTargets', () => {
  it('resolves the latest release, falls back to the latest tag, and reads tags only for SHA refs', async () => {
    const provider = stub({
      getLatestRelease: vi.fn(async (repo: string) =>
        repo === 'o/with-release'
          ? ok({
              tagName: 'v2.4.0',
              name: null,
              publishedAt: null,
              prerelease: false,
              htmlUrl: 'https://github.com/o/with-release',
            })
          : NOT_FOUND,
      ),
      getLatestTag: vi.fn(async () => ok({ name: 'v1.2.0', sha: A })),
      listTags: vi.fn(async () => ok([{ name: 'v1.2.0', sha: A }])),
    });
    const map = await collectReusableTargets(
      context(provider),
      ['o/with-release', 'o/only-tag'],
      new Set(['o/only-tag']),
    );
    expect(map.get('o/with-release')).toEqual({ latest: 'v2.4.0', tags: null, visible: true });
    expect(map.get('o/only-tag')).toEqual({
      latest: 'v1.2.0',
      tags: [{ name: 'v1.2.0', sha: A }],
      visible: true,
    });
    expect(provider.listTags).toHaveBeenCalledTimes(1);
  });

  it('a repository the credentials cannot see is not visible, never "behind"', async () => {
    const provider = stub({ getRepository: vi.fn(async () => NOT_FOUND) });
    const map = await collectReusableTargets(context(provider), ['o/private']);
    expect(map.get('o/private')).toEqual({ latest: null, tags: null, visible: false });
    expect(provider.getLatestRelease).not.toHaveBeenCalled();
  });

  it('a private target is withheld (unknown) for a public audience and shown when restricted', async () => {
    const mk = () =>
      stub({
        getRepository: vi.fn(async (repo: string) => ok(repoDto(repo.split('/')[1]!, 'private'))),
        getLatestRelease: vi.fn(async () =>
          ok({
            tagName: 'v9.0.0',
            name: null,
            publishedAt: null,
            prerelease: false,
            htmlUrl: 'https://github.com/o/shared',
          }),
        ),
      });
    const pub = mk();
    const hidden = await collectReusableTargets(context(pub), ['o/shared']);
    expect(hidden.get('o/shared')).toEqual({ latest: null, tags: null, visible: false });
    expect(pub.getLatestRelease).not.toHaveBeenCalled();
    const shown = await collectReusableTargets(
      context(mk(), (p) => {
        p.publication.audience = 'restricted';
      }),
      ['o/shared'],
    );
    expect(shown.get('o/shared')).toMatchObject({ latest: 'v9.0.0', visible: true });
  });

  it('scrubs the latest tag name and published tag names', async () => {
    const secret = 'ghp_' + 'a'.repeat(36);
    const provider = stub({
      getLatestRelease: vi.fn(async () => NOT_FOUND),
      getLatestTag: vi.fn(async () => ok({ name: secret, sha: A })),
      listTags: vi.fn(async () =>
        ok([
          { name: secret, sha: A },
          { name: 'v1.0.0', sha: A },
        ]),
      ),
    });
    const map = await collectReusableTargets(context(provider), ['o/x'], new Set(['o/x']));
    expect(JSON.stringify([...map])).not.toContain(secret);
    expect(map.get('o/x')!.latest).toBeNull();
    expect(map.get('o/x')!.tags).toEqual([{ name: 'v1.0.0', sha: A }]);
  });

  it('resolves at most 50 distinct repositories, case-insensitively; the rest are not visible', async () => {
    const provider = stub();
    const targets = [
      ...Array.from({ length: 60 }, (_, i) => `o/r${String(i).padStart(2, '0')}`),
      'O/R00',
    ];
    const map = await collectReusableTargets(context(provider), targets);
    expect(map.size).toBe(60);
    expect(provider.getRepository).toHaveBeenCalledTimes(MAX_REFERENCED_REPOSITORIES);
    expect(map.get('o/r00')!.visible).toBe(true);
    expect(map.get('o/r59')!.visible).toBe(false);
  });
});
