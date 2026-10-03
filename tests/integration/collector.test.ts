import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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
    await writeSnapshots(out, result.index, result.projects);
    const golden = 'fixtures/snapshots';
    const files = [
      'index.json',
      'collection-report.json',
      'collection-report.md',
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
    expect(index.run.repositories).toMatchObject({ total: 11, unavailable: 2 });
    expect(index.projects.map((p) => p.overall)).toEqual(['amber', 'red', 'grey']);
    expect(index.run.capabilities.secretScanning).toBe('partial');
  });
});

describe('sanitisation end to end', () => {
  const catalog = CatalogSchema.parse({
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
      path.endsWith('.json')
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
    const files = serialise(result.index, result.projects); // runs the strict schema + gate
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
      '"schemaVersion": "1.0"',
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
