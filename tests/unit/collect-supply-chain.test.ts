import { describe, expect, it, vi, type Mock } from 'vitest';
import { ProjectConfigSchema } from '@model/index';
import { collectRepository, type CollectContext } from '../../collector/src/collectors/collect';
import { harborImages, HARBOR_TAG } from '../../collector/src/normalizers/containers';
import { fail, ok, type SourceProvider } from '../../collector/src/providers/types';
import { createLimiter } from '../../collector/src/util/concurrency';
import { policies, repoDto } from '../helpers/factories';

const A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const NOT_FOUND = fail({ classification: 'not-found', httpStatus: 404 });
const digest = (c: string) => `sha256:${c.repeat(64)}`;

function stub(overrides: Partial<Record<keyof SourceProvider, unknown>> = {}) {
  return {
    dataSource: 'github',
    authenticationMode: 'fine-grained-token',
    dependencyGraphExport: true,
    getRepository: vi.fn(async (repo: string) => ok(repoDto(repo.split('/')[1]!))),
    getBranchHead: vi.fn(async () => ok({ sha: A, htmlUrl: null, committedAt: null })),
    getLatestRelease: vi.fn(async () => NOT_FOUND),
    getLatestTag: vi.fn(async () => NOT_FOUND),
    getFile: vi.fn(async () => NOT_FOUND),
    listCodeScanningAlerts: vi.fn(async () => ok([])),
    getLatestCodeScanningAnalysis: vi.fn(async () => ok(null)),
    listDependabotAlerts: vi.fn(async () => ok([])),
    listSecretScanningAlerts: vi.fn(async () => ok([])),
    getQualitySummary: vi.fn(async () => NOT_FOUND),
    listCodeQualityFindings: vi.fn(async () => ok([])),
    getSupplyChainSummary: vi.fn(async () => NOT_FOUND),
    listCodeScanningAnalyses: vi.fn(async () => ok([])),
    getAttestationPresence: vi.fn(async () => ok({ provenance: true, sbom: false })),
    requestDependencySbom: vi.fn(async () => ok({ uuid: '00000000-0000-4000-8000-000000000000' })),
    fetchDependencySbom: vi.fn(async () => ok({ state: 'pending' as const })),
    ...overrides,
  };
}
type Stub = ReturnType<typeof stub>;
const context = (
  provider: Stub,
  tweak: (p: ReturnType<typeof policies>) => void = () => {},
  sleep = vi.fn(async () => {}),
): CollectContext & { sleep: ReturnType<typeof vi.fn> } => ({
  provider: provider as unknown as SourceProvider,
  limit: createLimiter(4),
  cache: new Map(),
  policies: policies((p) => {
    p.repositoryControls.enabled = false;
    tweak(p);
  }),
  sleep,
});
const collect = (ctx: CollectContext) =>
  collectRepository(ctx, 'coordinator', 'example-org/svc', null, '.security/status.json');

describe('SBOM export collection', () => {
  it('without the provider switch nothing is requested and the dependency graph stays unused', async () => {
    const provider = stub({ dependencyGraphExport: false });
    const data = await collect(context(provider));
    expect(provider.requestDependencySbom).not.toHaveBeenCalled();
    expect(provider.fetchDependencySbom).not.toHaveBeenCalled();
    expect(data.sbomRequest).toBeNull();
    expect(data.sbomFetch).toBeNull();
  });

  it('supplyChain.enabled false: no supply chain call at all', async () => {
    const provider = stub();
    const data = await collect(context(provider, (p) => (p.supplyChain.enabled = false)));
    for (const f of [
      'requestDependencySbom',
      'getSupplyChainSummary',
      'listCodeScanningAnalyses',
      'getAttestationPresence',
    ] as const)
      expect(provider[f]).not.toHaveBeenCalled();
    expect(data.supplyChainSummary).toBeNull();
    expect(data.attestations).toBe('skipped');
    expect(data.analyses.size).toBe(0);
  });

  it('requests the export before the other calls of the repository', async () => {
    const order: string[] = [];
    const provider = stub({
      requestDependencySbom: vi.fn(async () => {
        order.push('sbom');
        return ok({ uuid: '00000000-0000-4000-8000-000000000000' });
      }),
      listDependabotAlerts: vi.fn(async () => {
        order.push('dependabot');
        return ok([]);
      }),
    });
    await collect(context(provider));
    expect(order[0]).toBe('sbom');
    expect(order).toContain('dependabot');
  });

  it('polls 202 up to pollAttempts more times with the configured wait, then stays pending', async () => {
    const provider = stub();
    const ctx = context(provider, (p) => {
      p.supplyChain.sbom.pollAttempts = 3;
      p.supplyChain.sbom.pollIntervalSeconds = 5;
    });
    const data = await collect(ctx);
    expect(provider.fetchDependencySbom).toHaveBeenCalledTimes(4);
    expect(ctx.sleep).toHaveBeenCalledTimes(3);
    expect(ctx.sleep).toHaveBeenCalledWith(5000);
    expect(data.sbomFetch).toEqual({ ok: true, data: { state: 'pending' } });
  });

  it('stops polling as soon as the report is ready', async () => {
    const fetchDependencySbom = vi
      .fn()
      .mockResolvedValueOnce(ok({ state: 'pending' }))
      .mockResolvedValueOnce(ok({ state: 'ready', text: '{}' }));
    const ctx = context(stub({ fetchDependencySbom }));
    const data = await collect(ctx);
    expect(fetchDependencySbom).toHaveBeenCalledTimes(2);
    expect(ctx.sleep).toHaveBeenCalledTimes(1);
    expect(data.sbomFetch).toMatchObject({ ok: true, data: { state: 'ready' } });
  });

  it('a failed request is kept and never polled', async () => {
    const provider = stub({
      requestDependencySbom: vi.fn(async () => fail({ classification: 'not-authorised' })),
    });
    const data = await collect(context(provider));
    expect(provider.fetchDependencySbom).not.toHaveBeenCalled();
    expect(data.sbomRequest).toMatchObject({ ok: false });
    expect(data.sbomFetch).toBeNull();
  });
});

describe('attestations and analyses collection', () => {
  const release = (assets: { name: string; digest: string | null }[]) =>
    ok({
      tagName: 'v1.0.0',
      name: null,
      publishedAt: null,
      prerelease: false,
      htmlUrl: 'https://github.com/example-org/svc/releases/tag/v1.0.0',
      assets,
    });

  it('asks at most maxAssets assets that have a digest, sorted by name', async () => {
    const provider = stub({
      getLatestRelease: vi.fn(async () =>
        release([
          { name: 'z.tar.gz', digest: digest('1') },
          { name: 'a.tar.gz', digest: digest('2') },
          { name: 'm.tar.gz', digest: null },
          { name: 'b.tar.gz', digest: digest('3') },
        ]),
      ),
    });
    const data = await collect(
      context(provider, (p) => (p.supplyChain.attestations.maxAssets = 2)),
    );
    expect((provider.getAttestationPresence as Mock).mock.calls.map((c) => c[1])).toEqual([
      digest('2'),
      digest('3'),
    ]);
    expect(data.attestations).not.toBe('skipped');
  });

  it('stops after the first 403', async () => {
    const provider = stub({
      getLatestRelease: vi.fn(async () =>
        release([
          { name: 'a', digest: digest('1') },
          { name: 'b', digest: digest('2') },
          { name: 'c', digest: digest('3') },
        ]),
      ),
      getAttestationPresence: vi.fn(async () => fail({ classification: 'not-authorised' })),
    });
    const data = await collect(context(provider));
    expect(provider.getAttestationPresence).toHaveBeenCalledTimes(1);
    expect(data.attestations instanceof Map && data.attestations.size).toBe(1);
  });

  it('no release (tag fallback) or releaseAssets off: skipped, no call', async () => {
    const none = stub();
    expect((await collect(context(none))).attestations).toBe('skipped');
    const off = stub({
      getLatestRelease: vi.fn(async () => release([{ name: 'a', digest: digest('1') }])),
    });
    await collect(context(off, (p) => (p.supplyChain.attestations.releaseAssets = false)));
    expect(off.getAttestationPresence).not.toHaveBeenCalled();
  });

  it('lists the analyses of each mapped tool once, on the default branch ref', async () => {
    const provider = stub();
    const data = await collect(context(provider));
    expect([...data.analyses.keys()].sort()).toEqual(['checkov', 'trivy', 'zap']);
    const calls = (provider.listCodeScanningAnalyses as Mock).mock.calls;
    expect(calls.map((c) => c[1]).sort()).toEqual(['Checkov', 'Trivy', 'ZAP']);
    expect(calls.every((c) => c[2] === 'refs/heads/main')).toBe(true);
  });
});

describe('Harbor image references', () => {
  const config = ProjectConfigSchema.parse({
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
        containerImages: [
          { project: 'alpha', repository: 'api' },
          { project: 'alpha', repository: 'api-rc', tagTemplate: 'rc-{version}' },
        ],
      },
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
  const refs = (version: string | null) =>
    harborImages(config, new Map([['api', version]])).map((i) => i.reference);

  it('renders the tag template with the effective version', () => {
    expect(refs('1.4.0')).toEqual(['1.4.0', 'rc-1.4.0']);
  });

  it('an unknown version, or one that is not a valid tag (it comes from repository content), is never asked', () => {
    expect(refs(null)).toEqual([null, null]);
    for (const bad of [
      '..',
      '.',
      '1.0.0/../../x',
      'a b',
      '%2e%2e',
      '-x',
      'x'.repeat(200),
      '1.0+build',
    ])
      expect(refs(bad)[0], bad).toBeNull();
    expect(HARBOR_TAG.test('1.4.0-rc.1')).toBe(true);
  });
});
