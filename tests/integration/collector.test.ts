import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CatalogSchema,
  PortfolioIndexSchema,
  ProjectSnapshotSchema,
  type ProjectSnapshot,
} from '@model/index';
import { loadConfig } from '../../collector/src/config/load';
import { MockProvider } from '../../collector/src/providers/mock/mock-provider';
import { fail, ok, type SourceProvider } from '../../collector/src/providers/types';
import { runCollection } from '../../collector/src/run';
import { fixedClock } from '../../collector/src/util/clock';
import { serialise, writeSnapshots } from '../../collector/src/writers/write-snapshots';
import { SanitizationError } from '../../collector/src/sanitizers/sanitize';
import { validatePortfolio, validateProject } from '../../src/lib/validate';
import { CANARIES } from '../helpers/canaries';

const GOLDEN_NOW = '2026-01-15T12:00:00.000Z';
let out: string;

beforeAll(async () => {
  out = await mkdtemp(join(tmpdir(), 'eph-collector-'));
});
afterAll(() => rm(out, { recursive: true, force: true }));

async function mockRun() {
  const { catalog, policies } = await loadConfig('config');
  const clock = fixedClock(GOLDEN_NOW);
  return runCollection({
    catalog,
    policies,
    provider: new MockProvider('fixtures/github', clock),
    clock,
  });
}

describe('mock collection', () => {
  it('reproduces the golden snapshots exactly', async () => {
    const result = await mockRun();
    const { catalog } = await loadConfig('config');
    await writeSnapshots(out, result.index, result.projects, catalog, result.discovery);
    const golden = 'fixtures/snapshots';
    const files = [
      'index.json',
      'collection-report.json',
      'collection-report.md',
      'catalog.json',
      ...(await readdir(join(golden, 'projects'))).map((f) => `projects/${f}`),
    ];
    for (const f of files) {
      expect(
        await readFile(join(out, f), 'utf8'),
        `${f} differs from golden — run "npm run fixtures:update" if intended`,
      ).toBe(await readFile(join(golden, f), 'utf8'));
    }
  });

  it('produces schema-valid snapshots with the intended demo scenarios', async () => {
    const { index, projects } = await mockRun();
    expect(PortfolioIndexSchema.safeParse(index).success).toBe(true);
    for (const p of projects) expect(ProjectSnapshotSchema.safeParse(p).success).toBe(true);
    const byId = Object.fromEntries(projects.map((p) => [p.project.id, p])) as Record<
      string,
      ProjectSnapshot
    >;

    const alpha = byId['project-alpha']!;
    expect(alpha.deliveryHealth.status).toBe('green');
    expect(alpha.environments.find((e) => e.id === 'prod')).toMatchObject({
      version: '1.3.0',
      status: 'behind',
    });
    expect(alpha.securityHealth.openCounts).toMatchObject({ critical: 0, high: 1 });
    expect(
      alpha.securityFindings.find((f) => f.source === 'github-dependabot' && f.status === 'open'),
    ).toMatchObject({ severity: 'high', fixAvailable: true });
    expect(alpha.securityCoverage).toMatchObject({ percentage: 75, required: 4, available: 3 });
    expect(alpha.overallHealth.status).toBe('amber');

    const beta = byId['project-beta']!;
    expect(beta.deliveryHealth.status).toBe('red');
    expect(
      beta.workflows.find((w) => w.componentId === 'api' && w.workflowId === 'ci'),
    ).toMatchObject({
      state: 'failure',
      lastError: 'Job "test" · step "Run integration tests"',
    });
    expect(beta.securityHealth.status).toBe('red');
    expect(
      beta.securityCoverage.perControl.find((c) => c.control === 'secretScanning')?.state,
    ).toBe('not-authorised');
    expect(beta.dataFreshness.status).toBe('amber');
    expect(
      beta.coordinator.submodules.find((s) => s.path === 'tools/legacy-scripts')?.association,
    ).toBe('unmapped');
    // Private repository: details withheld under the "public" audience policy, counts kept.
    const critical = beta.securityFindings.find((f) => f.severity === 'critical')!;
    expect(critical).toMatchObject({
      title: null,
      ruleId: null,
      repositoryPrivate: true,
      dataClassification: 'internal',
    });

    const gamma = byId['project-gamma']!;
    expect(gamma.overallHealth.status).toBe('grey');
    expect(gamma.securityHealth.openCounts.critical).toBeNull(); // unknown, not zero
    expect(gamma.securityCoverage.percentage).toBeNull();
    expect(gamma.collectionErrors.map((e) => e.classification).sort()).toEqual([
      'not-authorised',
      'not-found',
    ]);
  });

  it('keeps collecting other repositories when one fails (partial data)', async () => {
    const { index } = await mockRun();
    expect(index.run.repositories).toMatchObject({ total: 12, unavailable: 2 });
    expect(index.projects.map((p) => p.overall)).toEqual(['amber', 'amber', 'red', 'grey']);
    expect(index.run.capabilities.secretScanning).toBe('partial');
    // Platform: findings and setup both 404, so the permission is not proven everywhere.
    expect(index.run.capabilities.codeQuality).toBe('partial');
  });
});

/** The mock provider with some quality calls replaced. */
function withQuality(
  overrides: Partial<
    Pick<SourceProvider, 'getQualitySummary' | 'listCodeQualityFindings' | 'getCodeQualitySetup'>
  >,
): SourceProvider {
  const mock = new MockProvider('fixtures/github', fixedClock(GOLDEN_NOW));
  return new Proxy(mock, {
    get(target, prop, receiver) {
      const o = overrides[prop as keyof typeof overrides];
      if (o) return o;
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

async function runWith(provider: SourceProvider) {
  const { catalog, policies } = await loadConfig('config');
  return runCollection({ catalog, policies, provider, clock: fixedClock(GOLDEN_NOW) });
}

describe('quality dimension (mock run)', () => {
  const byId = (projects: ProjectSnapshot[]) =>
    Object.fromEntries(projects.map((p) => [p.project.id, p])) as Record<string, ProjectSnapshot>;

  it('beta qualityHealth.percentage 67.2 status amber', async () => {
    const beta = byId((await mockRun()).projects)['project-beta']!;
    expect(beta.qualityHealth).toMatchObject({
      status: 'amber',
      percentage: 67.2,
      measured: 2,
      applicable: 3,
      notVisible: 1,
    });
    expect(beta.qualityHealth.perComponent.map((c) => [c.componentId, c.state])).toEqual([
      ['coordinator', 'readable'],
      ['api', 'readable'],
      ['web', 'missing'],
      ['helm', 'not-applicable'],
    ]);
    expect(beta.qualityHealth.findings).toMatchObject({
      state: 'available',
      reliability: 1,
      maintainability: 9,
    });
  });

  it('alpha 84.7 green', async () => {
    const alpha = byId((await mockRun()).projects)['project-alpha']!;
    expect(alpha.qualityHealth).toMatchObject({
      status: 'green',
      percentage: 84.7,
      measured: 4,
      applicable: 4,
    });
    expect(alpha.qualityHealth.findings).toMatchObject({ reliability: 0, maintainability: 3 });
  });

  it('platform 58 red with quality-report-stale and staleSources contains quality-report', async () => {
    const platform = byId((await mockRun()).projects)['platform']!;
    expect(platform.qualityHealth).toMatchObject({ status: 'red', percentage: 58, stale: 4 });
    expect(platform.qualityHealth.reasons.map((r) => r.code)).toContain('quality-report-stale');
    expect(platform.qualityHealth.perComponent.every((c) => c.sharedRepository)).toBe(true);
    expect(platform.dataFreshness.staleSources).toContainEqual({
      repository: 'example-org/platform-mono',
      source: 'quality-report',
      lastUpdatedAt: '2025-12-26T12:00:00.000Z',
    });
    expect(platform.dataFreshness.status).toBe('amber');
  });

  it('gamma quality grey and overall/score unchanged vs a run without quality', async () => {
    const notFound = async () => fail<never>({ classification: 'not-found', httpStatus: 404 });
    const without = byId(
      (
        await runWith(
          withQuality({
            getQualitySummary: notFound,
            listCodeQualityFindings: notFound,
            getCodeQualitySetup: notFound,
          }),
        )
      ).projects,
    );
    const gamma = byId((await mockRun()).projects)['project-gamma']!;
    expect(gamma.qualityHealth.status).toBe('grey');
    expect(gamma.qualityHealth.percentage).toBeNull();
    expect(gamma.overallHealth).toEqual(without['project-gamma']!.overallHealth);
    expect(gamma.score).toEqual(without['project-gamma']!.score);
    // With no report anywhere, quality is grey everywhere and changes no overall or score.
    for (const p of Object.values(without)) {
      expect(p.qualityHealth.status, p.project.id).toBe('grey');
      expect(p.overallHealth.reasons.map((r) => r.params.dimension)).not.toContain('quality');
    }
    expect(Object.values(without).map((p) => p.score.required)).toEqual([5, 5, 5, 5]);
  });

  it('summary.quality matches snapshot', async () => {
    const { index, projects } = await mockRun();
    for (const p of projects) {
      const summary = index.projects.find((s) => s.id === p.project.id)!;
      expect(summary.quality).toEqual({
        status: p.qualityHealth.status,
        percentage: p.qualityHealth.percentage,
        measured: p.qualityHealth.measured,
        applicable: p.qualityHealth.applicable,
      });
    }
  });

  it('an expired artifact and an invalid summary (test-scoped fixtures)', async () => {
    // Copies of the demo fixtures, patched only here: the golden demo stays as published.
    const dir = await mkdtemp(join(tmpdir(), 'eph-quality-fixtures-'));
    try {
      await cp('fixtures/github', dir, { recursive: true });
      const patch = async (
        repo: string,
        edit: (q: { summary: Record<string, unknown>; expired?: boolean }) => void,
      ) => {
        const file = join(dir, `example-org__${repo}.json`);
        const fixture = JSON.parse(await readFile(file, 'utf8'));
        edit(fixture.qualitySummary);
        await writeFile(file, JSON.stringify(fixture));
      };
      // Newest default-branch artifact expired, no live one left.
      await patch('project-alpha-frontend', (q) => {
        q.expired = true;
      });
      // Extra key: the strict 1.0 contract rejects it, and its value must never be published.
      await patch('project-alpha-backend', (q) => {
        q.summary.path = 'src/internal/LeakyService.cs';
      });
      const { projects } = await runWith(new MockProvider(dir, fixedClock(GOLDEN_NOW)));
      const alpha = byId(projects)['project-alpha']!;
      const state = (id: string) =>
        alpha.qualityHealth.perComponent.find((c) => c.componentId === id)?.state;
      expect(state('frontend')).toBe('expired');
      expect(state('backend')).toBe('invalid');
      const reasons = alpha.qualityHealth.reasons.map((r) => [r.code, r.params.components]);
      expect(reasons).toContainEqual(['quality-report-expired', 'frontend']);
      expect(reasons).toContainEqual(['quality-report-invalid', 'backend']);
      // Coordinator + worker still measured: (2100 + 1720) / (2500 + 2000) = 84.9, capped amber.
      expect(alpha.qualityHealth).toMatchObject({
        status: 'amber',
        percentage: 84.9,
        measured: 2,
        notVisible: 2,
      });
      // Invalid: exactly one invalid-data error. Expired: a normal state, no error (spec §5.4).
      const errors = alpha.collectionErrors.filter((e) => e.source === 'quality-summary');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        repository: 'example-org/project-alpha-backend',
        componentId: 'backend',
        classification: 'invalid-data',
      });
      expect(JSON.stringify(projects)).not.toContain('LeakyService');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('codeQuality capability is not available when findings and setup are both unreadable', async () => {
    const notFound = async () => fail<never>({ classification: 'not-found', httpStatus: 404 });
    const denied = async () => fail<never>({ classification: 'not-authorised', httpStatus: 403 });
    // Platform-like everywhere: findings 404 + setup 404 proves nothing about the permission.
    const both404 = await runWith(
      withQuality({ listCodeQualityFindings: notFound, getCodeQualitySetup: notFound }),
    );
    expect(both404.index.run.capabilities.codeQuality).toBe('unknown');
    const setupDenied = await runWith(
      withQuality({ listCodeQualityFindings: notFound, getCodeQualitySetup: denied }),
    );
    expect(setupDenied.index.run.capabilities.codeQuality).toBe('not-authorised');
    // Findings 404 with a readable setup ("not configured") proves the permission works.
    const notConfigured = await runWith(
      withQuality({
        listCodeQualityFindings: notFound,
        getCodeQualitySetup: async () => ok({ state: 'not-configured' }),
      }),
    );
    expect(notConfigured.index.run.capabilities.codeQuality).toBe('available');
  });
});

describe('sanitisation end to end', () => {
  const catalog = CatalogSchema.parse({
    discovery: { enabled: true, owners: ['example-org'] },
    projects: [
      {
        id: 'canary',
        name: 'Canary',
        businessUnit: 'x',
        lifecycle: 'development',
        coordinator: { repository: 'example-org/canary' },
        components: [
          { id: 'svc', name: 'Svc', repository: 'example-org/canary-svc', type: 'service' },
        ],
        trackedWorkflows: [{ id: 'ci', name: 'CI', file: 'ci.yml', critical: true }],
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
          ].map((c) => [c, { required: true }]),
        ),
      },
    ],
  });
  const poison = CANARIES.join(' ');
  const url =
    'https://github.com/example-org/canary-svc/security/1?access_token=ghp_exampleSecretValue';
  const poisoned: SourceProvider = {
    dataSource: 'github',
    authenticationMode: 'fine-grained-token',
    getRepository: async (repo) =>
      ok({
        owner: 'example-org',
        name: repo.split('/')[1]!,
        fullName: repo,
        htmlUrl: `https://github.com/${repo}`,
        visibility: 'public',
        defaultBranch: 'main',
        archived: false,
        updatedAt: GOLDEN_NOW,
        topics: [poison],
      }),
    getBranchHead: async () => ok({ sha: 'c'.repeat(40), htmlUrl: url, committedAt: GOLDEN_NOW }),
    getLatestRelease: async () =>
      ok({
        tagName: `v1.0.0 ${poison}`,
        name: poison,
        publishedAt: GOLDEN_NOW,
        prerelease: false,
        htmlUrl: url,
      }),
    getLatestTag: async () => fail({ classification: 'not-found' }),
    getFile: async (_r, path) =>
      path === 'package.json'
        ? ok({ text: JSON.stringify({ workspaces: ['apps/*'], description: poison }) })
        : path.endsWith('.json')
          ? ok({
              text: JSON.stringify({
                schemaVersion: '1.0',
                generatedAt: GOLDEN_NOW,
                repository: 'example-org/canary-svc',
                controls: {
                  containerScanning: {
                    status: 'completed',
                    tool: poison,
                    critical: 0,
                    reportUrl: url,
                  },
                },
              }),
            })
          : fail({
              classification: 'not-authorised',
              httpStatus: 403,
              message: `Bad credentials ${poison} Authorization: token abc`,
            }),
    getSubmoduleRef: async () => fail({ classification: 'not-found' }),
    listTags: async () => ok([{ name: poison, sha: 'e'.repeat(40) }]),
    listOwnerRepositories: async () =>
      ok([
        {
          owner: 'example-org',
          name: 'canary-mono',
          fullName: 'example-org/canary-mono',
          htmlUrl: url,
          visibility: 'public',
          defaultBranch: 'main',
          archived: false,
          updatedAt: GOLDEN_NOW,
          topics: [poison],
        },
      ]),
    listDirectory: async (_r, path) =>
      ok(
        path === ''
          ? [{ name: 'package.json', type: 'file' }]
          : [
              { name: 'api', type: 'dir' },
              { name: 'web', type: 'dir' },
            ],
      ),
    listWorkflows: async () => ok([{ file: 'ci.yml', name: poison }]),
    compareCommits: async () => ok({ status: 'ahead', aheadBy: 1, behindBy: 0 }),
    listWorkflowRuns: async () =>
      ok([
        {
          id: 1,
          runNumber: 1,
          runAttempt: 1,
          status: 'completed',
          conclusion: 'failure',
          headBranch: poison,
          event: 'push',
          headSha: 'd'.repeat(40),
          createdAt: GOLDEN_NOW,
          updatedAt: GOLDEN_NOW,
          htmlUrl: url,
        },
      ]),
    getRunFailure: async () =>
      ok({
        jobName: poison,
        stepName: '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
      }),
    listCodeScanningAlerts: async () =>
      ok([
        {
          number: 1,
          state: 'open',
          dismissedReason: null,
          ruleId: poison,
          ruleSeverity: 'error',
          securitySeverityLevel: 'high',
          ruleDescription: `${poison} \`const password = "example"\``,
          toolName: poison,
          createdAt: GOLDEN_NOW,
          updatedAt: GOLDEN_NOW,
          htmlUrl: url,
        },
      ]),
    getLatestCodeScanningAnalysis: async () => ok({ createdAt: GOLDEN_NOW, toolName: poison }),
    listDependabotAlerts: async () =>
      ok([
        {
          number: 2,
          state: 'open',
          dismissedReason: null,
          ghsaId: poison,
          cveId: null,
          severity: 'high',
          summary: poison,
          packageName: poison,
          firstPatchedVersion: null,
          createdAt: GOLDEN_NOW,
          updatedAt: GOLDEN_NOW,
          htmlUrl: url,
        },
      ]),
    getQualitySummary: async (repo) =>
      ok({
        summaryText: JSON.stringify({
          schemaVersion: '1.0',
          repository: repo,
          ref: 'main',
          commitSha: 'c'.repeat(40),
          generatedAt: GOLDEN_NOW,
          tool: CANARIES[0],
          format: 'cobertura',
          lines: { covered: 1, valid: 2 },
        }),
        createdAt: GOLDEN_NOW,
        runUrl: url,
      }),
    listCodeQualityFindings: async () => ok([{ category: poison, severity: poison }]),
    getCodeQualitySetup: async () => ok({ state: poison }),
    listSecretScanningAlerts: async () =>
      ok([
        {
          number: 3,
          state: 'open',
          resolution: null,
          secretTypeDisplayName: poison,
          createdAt: GOLDEN_NOW,
          updatedAt: GOLDEN_NOW,
          htmlUrl: url,
        },
      ]),
  };

  it('publishes no canary value from any provider field', async () => {
    const { policies } = await loadConfig('config');
    const clock = fixedClock(GOLDEN_NOW);
    const result = await runCollection({ catalog, policies, provider: poisoned, clock });
    // Strict schemas + gate, including catalog.json with the discovery proposals.
    const files = serialise(result.index, result.projects, catalog, result.discovery);
    expect(result.discovery?.proposals[0]).toMatchObject({ kind: 'monorepo' });
    // The poisoned summary was read (so its tool really went through the pipeline).
    const quality = result.projects[0]!.qualityHealth;
    expect(quality.perComponent.map((c) => [c.state, c.tool])).toEqual([
      ['readable', null],
      ['readable', null],
    ]);
    expect(quality.findings.bySeverity.none).toBe(2);
    const all = [...files.values()].join('\n');
    for (const canary of CANARIES) expect(all).not.toContain(canary);
    expect(all).not.toContain('access_token');
    expect(all).not.toContain('Authorization: token');
  });

  it('refuses to write a snapshot that would leak a credential', async () => {
    const result = await mockRun();
    const leaky = structuredClone(result.projects);
    leaky[0]!.project.description = 'contact ghp_exampleSecretValue';
    expect(() => serialise(result.index, leaky)).toThrow(SanitizationError);
  });

  it('refuses unknown fields (allowlist, no raw payloads)', async () => {
    const result = await mockRun();
    const raw = structuredClone(result.projects) as unknown as Record<string, unknown>[];
    raw[0]!.rawPayload = { headers: {} };
    expect(() => serialise(result.index, raw as never)).toThrow(/Unrecognized key/);
  });
});

describe('snapshot schema versions', () => {
  it('fails in a controlled way on an unsupported schemaVersion', async () => {
    const text = (await readFile('fixtures/snapshots/index.json', 'utf8')).replace(
      '"schemaVersion": "1.4"',
      '"schemaVersion": "9.0"',
    );
    const r = validatePortfolio(text);
    expect(r).toMatchObject({
      ok: false,
      error: { kind: 'unsupported-schema', schemaVersion: '9.0' },
    });
  });
  it('validates every golden JSON file', async () => {
    expect(validatePortfolio(await readFile('fixtures/snapshots/index.json', 'utf8')).ok).toBe(
      true,
    );
    for (const f of await readdir('fixtures/snapshots/projects')) {
      expect(
        validateProject(await readFile(join('fixtures/snapshots/projects', f), 'utf8')).ok,
        f,
      ).toBe(true);
    }
  });
  it('rejects invalid JSON', () => expect(validateProject('{').ok).toBe(false));
});

describe('repositories that are not accessible', () => {
  it('are Unknown, never "workflow missing" / "status file missing" (all repos 404)', async () => {
    const { catalog, policies } = await loadConfig('config');
    const clock = fixedClock(GOLDEN_NOW);
    // Empty fixtures directory: every repository returns 404, as with a wrong catalog.
    const result = await runCollection({
      catalog,
      policies,
      provider: new MockProvider(tmpdir(), clock),
      clock,
    });
    for (const p of result.projects) {
      expect(p.overallHealth.status, p.project.id).toBe('grey');
      expect(p.deliveryHealth.status).toBe('grey');
      expect(p.securityCoverage.status).toBe('grey');
      expect(p.securityCoverage.percentage).toBeNull();
      expect(p.workflows.every((w) => w.state === 'unknown')).toBe(true);
      expect(p.governanceHealth.reasons.map((r) => r.code)).not.toContain(
        'standard-workflow-missing',
      );
      // One error per repository, not one per skipped call.
      expect(
        p.collectionErrors.every(
          (e) => e.source === 'repository' && e.classification === 'not-found',
        ),
      ).toBe(true);
    }
    expect(result.index.run.repositories).toMatchObject({ total: 12, unavailable: 12 });
    expect(result.index.run.capabilities.actions).toBe('not-used');
  });
});
