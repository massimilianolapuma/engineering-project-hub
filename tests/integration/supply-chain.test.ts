import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PROVIDERS_OFF, ProvidersFileSchema, type ProjectSnapshot } from '@model/index';
import { loadConfig } from '../../collector/src/config/load';
import { resolveProviderAuth } from '../../collector/src/providers/external/auth';
import { createExternalProviders } from '../../collector/src/providers/external/create';
import { createExternalClient } from '../../collector/src/providers/external/http';
import { createMockExternalProviders } from '../../collector/src/providers/external/mock';
import { createSonarQubeProvider } from '../../collector/src/providers/external/sonarqube';
import { MockProvider } from '../../collector/src/providers/mock/mock-provider';
import { runCollection } from '../../collector/src/run';
import { fixedClock } from '../../collector/src/util/clock';
import { reportMarkdown, writeSnapshots } from '../../collector/src/writers/write-snapshots';

const GOLDEN_NOW = '2026-01-15T12:00:00.000Z';
const clock = fixedClock(GOLDEN_NOW);

/** Overall status, score and dimension statuses of the v0.9.0 goldens (before this release). */
const BEFORE = {
  platform: { overall: 'red', score: 49, dims: ['green', 'green', 'red', 'green', 'green', 'red'] },
  'project-alpha': {
    overall: 'amber',
    score: 78,
    dims: ['green', 'amber', 'amber', 'amber', 'green', 'green'],
  },
  'project-beta': {
    overall: 'red',
    score: 40,
    dims: ['red', 'amber', 'red', 'amber', 'amber', 'amber'],
  },
  'project-gamma': {
    overall: 'grey',
    score: null,
    dims: ['grey', 'grey', 'grey', 'grey', 'grey', 'grey'],
  },
} as const;

type Run = Awaited<ReturnType<typeof runCollection>>;
const byId = (r: Run) =>
  Object.fromEntries(r.projects.map((p) => [p.project.id, p])) as Record<string, ProjectSnapshot>;
const dims = (p: ProjectSnapshot) => [
  p.deliveryHealth.status,
  p.versionHealth.status,
  p.securityHealth.status,
  p.securityCoverage.status,
  p.governanceHealth.status,
  p.qualityHealth.status,
];

async function mockConfig(providersFile = 'fixtures/providers/providers.yaml') {
  return loadConfig('config', {
    exceptionsFile: 'fixtures/exceptions/exceptions.yaml',
    providersFile,
    allowDateTokens: true,
    now: new Date(GOLDEN_NOW),
  });
}

let withProviders: Run;
beforeAll(async () => {
  const { catalog, policies, exceptions, providers } = await mockConfig();
  withProviders = await runCollection({
    catalog,
    policies,
    provider: new MockProvider('fixtures/github', clock),
    clock,
    exceptions,
    providers: providers.file,
    external: createMockExternalProviders('fixtures/providers', clock, providers.file),
  });
});

function expectUnchanged(r: Run) {
  for (const [id, p] of Object.entries(byId(r))) {
    const before = BEFORE[id as keyof typeof BEFORE];
    expect(p.overallHealth.status, `${id} overall`).toBe(before.overall);
    expect(p.score.value, `${id} score`).toBe(before.score);
    expect(dims(p), `${id} dimensions`).toEqual(before.dims);
  }
}

describe('supply chain providers: no status change', () => {
  it('with the mock providers every overall status, score and dimension status equals the v0.9.0 goldens', () => {
    expectUnchanged(withProviders);
  });

  it('with config/providers.yaml (all off) no external fetch is made and statuses equal the goldens', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network used'));
    try {
      const { catalog, policies, exceptions, providers } = await loadConfig('config', {
        exceptionsFile: 'fixtures/exceptions/exceptions.yaml',
        allowDateTokens: true,
        now: new Date(GOLDEN_NOW),
      });
      expect(providers.file).toEqual(PROVIDERS_OFF);
      // The real factory with everything off: no client exists, so nothing can be contacted.
      const auth = resolveProviderAuth(providers.file, {
        SONARQUBE_TOKEN: 'x',
        ARGOCD_TOKEN: 'y',
        HARBOR_ROBOT_NAME: 'n',
        HARBOR_ROBOT_SECRET: 's',
      });
      const external = createExternalProviders(providers.file, auth, { mock: false });
      expect(external).toEqual({ sonarqube: null, harbor: null, argocd: null });
      const r = await runCollection({
        catalog,
        policies,
        provider: new MockProvider('fixtures/github', clock),
        clock,
        exceptions,
        providers: providers.file,
        external,
        providerAuth: auth,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expectUnchanged(r);
      expect(r.index.run.providers).toEqual({
        sonarqube: { enabled: false, state: 'off', items: 0, errors: 0 },
        harbor: { enabled: false, state: 'off', items: 0, errors: 0 },
        argocd: { enabled: false, state: 'off', items: 0, errors: 0 },
      });
      const p = byId(r);
      // No Quality source, no deployment, no Harbor: the CI-only picture of v0.9.0.
      expect(p['project-beta']!.qualityHealth.percentage).toBe(67.2);
      expect(p['project-alpha']!.environments.every((e) => e.deployment === null)).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('the demo policies keep the SBOM export off, yet the mock still serves fixture SBOMs', async () => {
    const { policies } = await mockConfig();
    expect(policies.supplyChain.sbom.dependencyGraph).toBe(false);
    const alpha = byId(withProviders)['project-alpha']!;
    expect(
      alpha.supplyChain.repositories.find((r) => r.repository.endsWith('-backend'))!.sbom,
    ).toMatchObject({ state: 'available', source: 'dependency-graph' });
  });
});

describe('supply chain providers: golden story', () => {
  const control = (p: ProjectSnapshot, componentId: string, id: string) =>
    p.securityControls
      .find((c) => c.componentId === componentId)!
      .controls.find((c) => c.control === id)!;

  it('alpha-backend containerScanning is won by Harbor (medium 2, low 6), evidence reported', () => {
    const alpha = byId(withProviders)['project-alpha']!;
    expect(control(alpha, 'backend', 'containerScanning')).toMatchObject({
      state: 'enabled',
      source: 'harbor',
      evidence: 'reported',
      tool: 'Harbor',
      counts: { critical: 0, high: 0, medium: 2, low: 6 },
    });
    // Alpha's totals reflect Harbor, not the status file's 1 / 3: 3 − 1 + 2 and 3 − 3 + 6.
    expect(alpha.securityHealth.openCounts).toMatchObject({ high: 1, medium: 4, low: 6 });
  });

  it('alpha-frontend containerScanning stays with the status file (Harbor not found is non-definitive)', () => {
    const alpha = byId(withProviders)['project-alpha']!;
    expect(control(alpha, 'frontend', 'containerScanning')).toMatchObject({
      state: 'enabled',
      source: 'status-file',
    });
    expect(control(alpha, 'frontend', 'dast')).toMatchObject({
      state: 'stale',
      source: 'code-scanning',
    });
  });

  it('platform containerScanning is enabled via code scanning (Trivy) and adds nothing to the counts', () => {
    const platform = byId(withProviders).platform!;
    expect(control(platform, 'coordinator', 'containerScanning')).toMatchObject({
      state: 'enabled',
      source: 'code-scanning',
      tool: 'Trivy',
    });
    expect(platform.securityHealth.openCounts).toMatchObject({ high: 2, medium: 1, low: 0 });
  });

  it('beta Quality 66.7 amber: web is read from SonarQube with a failed gate, at info', () => {
    const beta = byId(withProviders)['project-beta']!;
    expect(beta.qualityHealth).toMatchObject({ status: 'amber', percentage: 66.7 });
    const web = beta.qualityHealth.perComponent.find((c) => c.componentId === 'web')!;
    expect(web).toMatchObject({
      state: 'readable',
      source: 'sonarqube',
      qualityGate: 'failed',
      newCoverage: 41.2,
    });
    const codes = beta.qualityHealth.reasons.map((r) => r.code);
    expect(codes).not.toContain('quality-report-missing');
    expect(beta.qualityHealth.reasons.find((r) => r.code === 'quality-gate-failed')).toMatchObject({
      level: 'info',
      params: { components: 'web' },
    });
  });

  it('alpha Quality 84.7: the backend row keeps the CI summary and takes the gate from SonarQube', () => {
    const alpha = byId(withProviders)['project-alpha']!;
    expect(alpha.qualityHealth.percentage).toBe(84.7);
    expect(alpha.qualityHealth.perComponent.find((c) => c.componentId === 'backend')).toMatchObject(
      {
        source: 'ci-summary',
        qualityGate: 'passed',
      },
    );
  });

  it('gamma Quality stays grey and its service row says not-authorised', () => {
    const gamma = byId(withProviders)['project-gamma']!;
    expect(gamma.qualityHealth.status).toBe('grey');
    expect(gamma.qualityHealth.perComponent.find((c) => c.componentId === 'service')).toMatchObject(
      {
        state: 'not-authorised',
        source: 'sonarqube',
      },
    );
  });

  it('beta-api finding #21 is a Checkov alert of category iac', () => {
    const beta = byId(withProviders)['project-beta']!;
    const f = beta.securityFindings.find(
      (x) => x.id === 'example-org/project-beta-api#code-scanning#21',
    )!;
    expect(f).toMatchObject({ category: 'iac', tool: 'Checkov', severity: 'low' });
    expect(
      beta.securityHealth.reasons.find((r) => r.code === 'supply-chain-unsigned-artifact'),
    ).toMatchObject({
      level: 'info',
    });
  });

  it('supply chain totals per project', () => {
    const p = byId(withProviders);
    expect(p['project-alpha']!.supplyChain.totals).toEqual({
      repositories: 5,
      sbomAvailable: 3,
      signedImages: 2, // backend and frontend: the CI summary and Harbor report one digest each
      unsignedImages: 0,
      attestedAssets: 1,
      flagged: 0,
    });
    expect(p['project-beta']!.supplyChain.totals).toEqual({
      repositories: 4,
      sbomAvailable: 0,
      signedImages: 0,
      unsignedImages: 1, // beta-api: one digest, reported by the CI summary and Harbor
      attestedAssets: null,
      flagged: null,
    });
    expect(p.platform!.supplyChain.totals).toEqual({
      repositories: 1,
      sbomAvailable: 1,
      signedImages: 0,
      unsignedImages: 0,
      attestedAssets: 0,
      flagged: 2,
    });
    expect(p['project-gamma']!.supplyChain.totals).toEqual({
      repositories: 2,
      sbomAvailable: null,
      signedImages: 0,
      unsignedImages: 0,
      attestedAssets: null,
      flagged: null,
    });
    expect(withProviders.index.projects.find((x) => x.id === 'project-alpha')!.supplyChain).toEqual(
      { repositories: 5, sbomAvailable: 3, unsignedImages: 0, flagged: 0 },
    );
  });

  it('SBOM sections: backend, frontend, worker and platform', () => {
    const p = byId(withProviders);
    const repo = (id: string, suffix: string) =>
      p[id]!.supplyChain.repositories.find((r) => r.repository.endsWith(suffix))!;
    expect(repo('project-alpha', '-backend').sbom).toMatchObject({
      state: 'available',
      source: 'dependency-graph',
      format: 'spdx',
      packages: 214,
      withoutLicense: 6,
      licenses: [
        { id: 'Apache-2.0', count: 120 },
        { id: 'MIT', count: 70 },
        { id: 'BSD-3-Clause', count: 12 },
        { id: 'EPL-2.0', count: 6 },
      ],
      ecosystems: [{ id: 'maven', count: 214 }],
    });
    const frontend = repo('project-alpha', '-frontend').sbom;
    expect(frontend).toMatchObject({
      state: 'available',
      source: 'supply-chain-summary',
      format: 'cyclonedx',
    });
    expect(frontend.licenses).toContainEqual({ id: 'LicenseRef-*', count: 3 });
    expect(repo('project-alpha', '-worker').sbom).toMatchObject({
      state: 'pending',
      packages: null,
    });
    expect(repo('project-alpha', '-worker').attestations).toMatchObject({
      state: 'unknown',
      withoutDigest: 1,
    });
    const mono = repo('platform', 'platform-mono').sbom;
    expect(mono).toMatchObject({ packages: 1530, withoutLicense: 3, flagged: 2 });
    expect(mono.ecosystems).toEqual([
      { id: 'npm', count: 1480 },
      { id: 'githubactions', count: 50 },
    ]);
    expect(mono.licenses.slice(0, 7)).toEqual([
      { id: 'MIT', count: 1100 },
      { id: 'ISC', count: 200 },
      { id: 'Apache-2.0', count: 150 },
      { id: 'BSD-2-Clause', count: 40 },
      { id: 'BSD-3-Clause', count: 25 },
      { id: 'MIT OR Apache-2.0', count: 10 },
      { id: 'GPL-3.0-only', count: 2 },
    ]);
  });

  it('environments: alpha dev/uat/prod and beta dev/prod', () => {
    const p = byId(withProviders);
    const env = (id: string, e: string) => p[id]!.environments.find((x) => x.id === e)!;
    expect(env('project-alpha', 'dev')).toMatchObject({
      version: '1.4.0',
      source: 'argocd',
      status: 'aligned',
      deployment: {
        state: 'available',
        sync: 'synced',
        health: 'healthy',
        images: [
          { componentId: 'backend', version: '1.4.0' },
          { componentId: 'frontend', version: '2.1.0' },
        ],
      },
    });
    expect(env('project-alpha', 'uat')).toMatchObject({
      source: 'manifest',
      deployment: { sync: 'out-of-sync', health: 'progressing', version: null },
    });
    expect(
      p['project-alpha']!.versionHealth.reasons.find((r) => r.code === 'environment-out-of-sync'),
    ).toMatchObject({ level: 'info' });
    expect(env('project-alpha', 'prod')).toMatchObject({
      version: '1.3.0',
      source: 'argocd',
      status: 'behind',
    });
    expect(env('project-alpha', 'test').deployment).toBeNull();
    expect(env('project-beta', 'prod').deployment).toMatchObject({ health: 'degraded' });
    expect(env('project-beta', 'dev')).toMatchObject({
      version: '3.2.0',
      source: 'manifest',
      deployment: { state: 'not-authorised' },
    });
  });

  it('collection errors: Alpha 1 (harbor), Beta 3 (dependency-sbom, attestations, argocd), Gamma 1 (sonarqube)', () => {
    const p = byId(withProviders);
    const sources = [
      'dependency-sbom',
      'attestations',
      'supply-chain-summary',
      'sonarqube',
      'harbor',
      'argocd',
    ];
    const of = (id: string) =>
      p[id]!.collectionErrors.filter((e) => sources.includes(e.source))
        .map((e) => e.source)
        .sort();
    expect(of('project-alpha')).toEqual(['harbor']);
    expect(of('project-beta')).toEqual(['argocd', 'attestations', 'dependency-sbom']);
    expect(of('project-gamma')).toEqual(['sonarqube']);
    expect(of('platform')).toEqual([]);
  });

  it('run.providers, capabilities and the report line', () => {
    const { run } = withProviders.index;
    expect(run.providers).toEqual({
      sonarqube: { enabled: true, state: 'partial', items: 3, errors: 1 },
      harbor: { enabled: true, state: 'available', items: 3, errors: 1 },
      argocd: { enabled: true, state: 'partial', items: 5, errors: 1 },
    });
    expect(run.capabilities.dependencyGraph).toBe('partial');
    expect(run.capabilities.attestations).toBe('partial');
  });
});

describe('supply chain providers: collection report and canaries', () => {
  let out: string;
  beforeAll(async () => {
    out = await mkdtemp(join(tmpdir(), 'eph-supply-'));
  });
  afterAll(() => rm(out, { recursive: true, force: true }));

  it('collection-report.md has the Providers line', async () => {
    const report = await writeSnapshots(out, withProviders.index, withProviders.projects);
    const md = await readFile(join(out, 'collection-report.md'), 'utf8');
    expect(md).toContain(
      'Providers: sonarqube partial (3 items, 1 error) · harbor available (3, 1 error) · argocd partial (5, 1 error)',
    );
    expect(report.providers.sonarqube).toMatchObject({ state: 'partial' });
  });

  it('says "Providers: all off" when nothing is on', () => {
    const off = {
      sonarqube: { enabled: false, state: 'off' as const, items: 0, errors: 0 },
      harbor: { enabled: false, state: 'off' as const, items: 0, errors: 0 },
      argocd: { enabled: false, state: 'off' as const, items: 0, errors: 0 },
    };
    const md = reportMarkdown({
      providers: off,
      projects: [],
      errors: [],
      exceptions: { source: 'none' },
      repositories: { total: 0, ok: 0, withErrors: 0, unavailable: 0 },
      history: null,
    } as never);
    expect(md).toContain('Providers: all off');
  });

  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])),
      )
    ).flat();
  }

  it('the canaries are absent from every output file and from the golden snapshots', async () => {
    const canaries = [
      'canary-internal-pkg-7f3a',
      'LicenseRef-canary-acme-9b2e',
      'git.internal.example',
      'kubernetes.internal.example',
      'canary-img-4d2e',
      'ghp_canary_harbor_scanner_7c1e',
    ];
    for (const dir of [out, 'fixtures/snapshots']) {
      for (const file of await walk(dir)) {
        const text = await readFile(file, 'utf8');
        for (const canary of canaries) expect(text, `${file} / ${canary}`).not.toContain(canary);
      }
    }
  });

  it('a SonarQube token in the environment never reaches the output or the console', async () => {
    const TOKEN = 'sonar-canary-0123456789';
    const providers = ProvidersFileSchema.parse({
      schemaVersion: '1.0',
      sonarqube: { enabled: true, baseUrl: 'https://sonarqube.example.invalid' },
    });
    const auth = resolveProviderAuth(providers, { SONARQUBE_TOKEN: TOKEN });
    expect(auth.sonarqube.authHeader).toBe(`Bearer ${TOKEN}`);
    // The server answers with an error that echoes the credential: it must not survive.
    const fetcher = (async () =>
      new Response(JSON.stringify({ message: `bad token ${TOKEN}` }), {
        status: 500,
      })) as typeof fetch;
    const external = {
      sonarqube: createSonarQubeProvider(
        createExternalClient({
          id: 'sonarqube',
          baseUrl: 'https://sonarqube.example.invalid',
          timeoutSeconds: 5,
          authHeader: auth.sonarqube.authHeader,
          fetch: fetcher,
        }),
      ),
      harbor: null,
      argocd: null,
    };
    const { catalog, policies, exceptions } = await mockConfig();
    const logs: string[] = [];
    const sink = (...args: unknown[]) => void logs.push(args.map(String).join(' '));
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(sink),
      vi.spyOn(console, 'warn').mockImplementation(sink),
      vi.spyOn(console, 'error').mockImplementation(sink),
    ];
    try {
      const r = await runCollection({
        catalog,
        policies,
        provider: new MockProvider('fixtures/github', clock),
        clock,
        exceptions,
        providers,
        external,
        providerAuth: auth,
      });
      const dir = await mkdtemp(join(tmpdir(), 'eph-token-'));
      await writeSnapshots(dir, r.index, r.projects);
      expect(r.index.run.providers.sonarqube).toMatchObject({ enabled: true, state: 'unknown' });
      for (const file of await walk(dir)) expect(await readFile(file, 'utf8')).not.toContain(TOKEN);
      await rm(dir, { recursive: true, force: true });
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    expect(logs.join('\n')).not.toContain(TOKEN);
  });

  it('an enabled provider without a credential is not-authorised and the run goes on', async () => {
    const providers = ProvidersFileSchema.parse({
      schemaVersion: '1.0',
      sonarqube: { enabled: true, baseUrl: 'https://sonarqube.example.invalid' },
    });
    const auth = resolveProviderAuth(providers, {});
    expect(auth.sonarqube.authHeader).toBeNull();
    const spy = vi.fn();
    const external = createExternalProviders(providers, auth, { mock: false });
    const { catalog, policies, exceptions } = await mockConfig();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(spy);
    try {
      const r = await runCollection({
        catalog,
        policies,
        provider: new MockProvider('fixtures/github', clock),
        clock,
        exceptions,
        providers,
        external,
        providerAuth: auth,
      });
      // No credential: nothing is sent, every mapped item is not authorised.
      expect(spy).not.toHaveBeenCalled();
      expect(r.index.run.providers.sonarqube).toMatchObject({
        enabled: true,
        state: 'not-authorised',
        items: 3,
        errors: 3,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('the per-run maxItems cap leaves the surplus items unknown, always the same ones', async () => {
    const providers = ProvidersFileSchema.parse({
      schemaVersion: '1.0',
      sonarqube: { enabled: true, baseUrl: 'https://sonarqube.example.invalid', maxItems: 1 },
    });
    const { catalog, policies, exceptions } = await mockConfig();
    const run = () =>
      runCollection({
        catalog,
        policies,
        provider: new MockProvider('fixtures/github', clock),
        clock,
        exceptions,
        providers,
        external: createMockExternalProviders('fixtures/providers', clock, providers),
      });
    const a = await run();
    const b = await run();
    expect(a.index.run.providers.sonarqube).toMatchObject({ items: 1 });
    expect(JSON.stringify(a.projects)).toBe(JSON.stringify(b.projects));
    // The first key in catalog order (alpha backend) was read; beta web and gamma were not.
    const beta = byId(a)['project-beta']!;
    expect(beta.qualityHealth.perComponent.find((c) => c.componentId === 'web')!.state).toBe(
      'unknown',
    );
  });
});
