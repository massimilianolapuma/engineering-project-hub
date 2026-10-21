import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CatalogSchema,
  ChangesFileSchema,
  HistoryFileSchema,
  PortfolioIndexSchema,
  ProjectSnapshotSchema,
  type Catalog,
  type ChangesFile,
  type DataSource,
  type HistoryFile,
  type Policies,
  type ProjectSnapshot,
} from '@model/index';
import { loadConfig } from '../../collector/src/config/load';
import { buildHistoryExtras } from '../../collector/src/history/extras';
import { loadPreviousHistory } from '../../collector/src/history/load';
import { MockProvider } from '../../collector/src/providers/mock/mock-provider';
import { fail, ok, type SourceProvider } from '../../collector/src/providers/types';
import { runCollection } from '../../collector/src/run';
import { fixedClock } from '../../collector/src/util/clock';
import {
  serialise,
  writeSnapshots,
  type HistoryExtras,
} from '../../collector/src/writers/write-snapshots';
import { SanitizationError } from '../../collector/src/sanitizers/sanitize';
import {
  validateChanges,
  validateHistory,
  validatePortfolio,
  validateProject,
} from '../../src/lib/validate';
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

/**
 * The history pipeline as the CLI and the golden script run it: load the previous history
 * (before anything is written), append the run, diff against the previous.
 */
async function historyExtras(
  result: Awaited<ReturnType<typeof mockRun>>,
  o: {
    catalog: Catalog;
    policies: Policies;
    dataSource?: DataSource;
    historyFrom?: string;
    fixturePath?: string;
    restoreState?: string;
  },
): Promise<HistoryExtras & { history: HistoryFile; changes: ChangesFile }> {
  const now = new Date(result.index.generatedAt);
  const previous = await loadPreviousHistory({
    dataSource: o.dataSource ?? 'mock',
    historyFrom: o.historyFrom ?? 'fixtures/snapshots',
    fixturePath: o.fixturePath ?? 'fixtures/history/history.json',
    restoreState: o.restoreState,
    catalog: o.catalog,
    policies: o.policies,
    now,
  });
  const extras = buildHistoryExtras(
    previous,
    result.index,
    result.projects,
    o.catalog,
    o.policies,
    now,
  );
  expect(extras.history).not.toBeNull();
  expect(extras.changes).not.toBeNull();
  return extras as HistoryExtras & { history: HistoryFile; changes: ChangesFile };
}

describe('mock collection', () => {
  it('reproduces the golden snapshots exactly', async () => {
    const result = await mockRun();
    const { catalog, policies } = await loadConfig('config');
    const extras = await historyExtras(result, { catalog, policies });
    await writeSnapshots(out, result.index, result.projects, catalog, result.discovery, extras);
    const golden = 'fixtures/snapshots';
    const files = [
      'index.json',
      'collection-report.json',
      'collection-report.md',
      'catalog.json',
      'history.json',
      'changes.json',
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
    // Platform: findings 404 still proves the permission works (house rule for a 404).
    expect(index.run.capabilities.codeQuality).toBe('available');
  });
});

/** The mock provider with some quality calls replaced. */
function withQuality(
  overrides: Partial<Pick<SourceProvider, 'getQualitySummary' | 'listCodeQualityFindings'>>,
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

const readGolden = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(join('fixtures/snapshots', file), 'utf8')) as T;

describe('history and changes (mock run)', () => {
  it('golden changes totals are {statusChanges:4,newFindings:1,resolvedFindings:1,versionMoves:1,newErrors:1}', async () => {
    const changes = await readGolden<ChangesFile>('changes.json');
    expect(changes.totals).toEqual({
      statusChanges: 4,
      newFindings: 1,
      resolvedFindings: 1,
      versionMoves: 1,
      newErrors: 1,
    });
  });

  it('golden changes: beta statusChanges [overall amber→red, delivery amber→red, security amber→red], newFindings[0].id "example-org/project-beta-api#code-scanning#3" with title null, findingsPartial true', async () => {
    const beta = (await readGolden<ChangesFile>('changes.json')).projects.find(
      (p) => p.id === 'project-beta',
    )!;
    expect(beta.statusChanges).toEqual([
      { dimension: 'overall', from: 'amber', to: 'red' },
      { dimension: 'delivery', from: 'amber', to: 'red' },
      { dimension: 'security', from: 'amber', to: 'red' },
    ]);
    expect(beta.newFindings[0]).toMatchObject({
      id: 'example-org/project-beta-api#code-scanning#3',
      title: null,
    });
    expect(beta.findingsPartial).toBe(true);
    expect(beta.newErrors).toEqual([
      {
        repository: 'example-org/project-beta-web',
        source: 'secret-scanning',
        classification: 'not-authorised',
      },
    ]);
    expect(beta.previous).toEqual({ overall: 'amber', score: 58 });
    expect(beta.current).toEqual({ overall: 'red', score: 40 });
  });

  it('golden changes: alpha versionMoves [{kind:"component", componentId:"frontend", from:"2.0.3", to:"2.1.0"}] and resolvedFindings[0].id "example-org/project-alpha-backend#code-scanning#9"', async () => {
    const alpha = (await readGolden<ChangesFile>('changes.json')).projects.find(
      (p) => p.id === 'project-alpha',
    )!;
    expect(alpha.versionMoves).toEqual([
      { kind: 'component', componentId: 'frontend', from: '2.0.3', to: '2.1.0' },
    ]);
    expect(alpha.resolvedFindings[0]!.id).toBe('example-org/project-alpha-backend#code-scanning#9');
    expect(alpha.statusChanges).toEqual([{ dimension: 'delivery', from: 'amber', to: 'green' }]);
    expect(alpha.newFindings).toEqual([]);
  });

  it('golden changes: platform and gamma have empty lists; basis {state:"compared", previousCollectedAt:"2026-01-14T12:00:00.000Z", synthetic:true}', async () => {
    const changes = await readGolden<ChangesFile>('changes.json');
    for (const id of ['platform', 'project-gamma']) {
      expect(changes.projects.find((p) => p.id === id)).toMatchObject({
        added: false,
        statusChanges: [],
        newFindings: [],
        resolvedFindings: [],
        versionMoves: [],
        newErrors: [],
      });
    }
    expect(changes.basis).toEqual({
      state: 'compared',
      previousCollectedAt: '2026-01-14T12:00:00.000Z',
      synthetic: true,
    });
  });

  it('golden history: 13 entries, first 2026-01-03T12:00:00.000Z, last 2026-01-15T12:00:00.000Z, restore {state:"fixture", previousEntries:12}', async () => {
    const h = await readGolden<HistoryFile>('history.json');
    expect(h.entries).toHaveLength(13);
    expect(h.entries[0]!.collectedAt).toBe('2026-01-03T12:00:00.000Z');
    expect(h.entries.at(-1)!.collectedAt).toBe('2026-01-15T12:00:00.000Z');
    expect(h.restore).toEqual({ state: 'fixture', previousEntries: 12 });
    expect(h.baseline.collectedAt).toBe('2026-01-15T12:00:00.000Z');
  });

  it('golden history: platform appears in 10 entries, alpha has score null on 2026-01-09T12:00:00.000Z', async () => {
    const h = await readGolden<HistoryFile>('history.json');
    expect(h.entries.filter((e) => e.projects.some((p) => p.id === 'platform'))).toHaveLength(10);
    const gap = h.entries.find((e) => e.collectedAt === '2026-01-09T12:00:00.000Z')!;
    expect(gap.projects.find((p) => p.id === 'project-alpha')).toMatchObject({
      score: null,
      scoreMeasured: 2,
      scoreRequired: 6,
    });
    // Gamma is unknown throughout: never a number.
    expect(
      h.entries.every((e) => e.projects.find((p) => p.id === 'project-gamma')!.score === null),
    ).toBe(true);
  });

  it('fixtures:update is idempotent', async () => {
    const { catalog, policies } = await loadConfig('config');
    const dirs = [
      await mkdtemp(join(tmpdir(), 'eph-idem-')),
      await mkdtemp(join(tmpdir(), 'eph-idem-')),
    ];
    try {
      const result = await mockRun();
      // The second run sees the first one's output as its history directory; mock ignores it.
      await writeSnapshots(
        dirs[0]!,
        result.index,
        result.projects,
        catalog,
        result.discovery,
        await historyExtras(result, { catalog, policies }),
      );
      await writeSnapshots(
        dirs[1]!,
        result.index,
        result.projects,
        catalog,
        result.discovery,
        await historyExtras(result, { catalog, policies, historyFrom: dirs[0]! }),
      );
      for (const f of ['history.json', 'changes.json', 'index.json', 'collection-report.md'])
        expect(await readFile(join(dirs[1]!, f), 'utf8'), f).toBe(
          await readFile(join(dirs[0]!, f), 'utf8'),
        );
    } finally {
      await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    }
  });

  it('github-mode restore appends', async () => {
    const { catalog, policies } = await loadConfig('config');
    const dir = await mkdtemp(join(tmpdir(), 'eph-restore-'));
    try {
      const golden = await readFile('fixtures/snapshots/history.json', 'utf8');
      await writeFile(
        join(dir, 'history.json'),
        golden.replaceAll('"dataSource":"mock"', '"dataSource":"github"'),
      );
      const clock = fixedClock('2026-01-15T18:00:00.000Z');
      const mock = new MockProvider('fixtures/github', clock);
      const provider: SourceProvider = Object.assign(Object.create(mock) as SourceProvider, {
        dataSource: 'github',
        authenticationMode: 'github-token',
      });
      const result = await runCollection({ catalog, policies, provider, clock });
      const extras = await historyExtras(result, {
        catalog,
        policies,
        dataSource: 'github',
        historyFrom: dir,
        fixturePath: join(dir, 'unused-fixture.json'),
      });
      expect(extras.history.entries).toHaveLength(14);
      expect(extras.history.restore).toEqual({ state: 'restored', previousEntries: 13 });
      expect(extras.changes.basis).toMatchObject({
        state: 'compared',
        previousCollectedAt: '2026-01-15T12:00:00.000Z',
        synthetic: false,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('a mock run never restores a history in the output directory', async () => {
    const { catalog, policies } = await loadConfig('config');
    const dir = await mkdtemp(join(tmpdir(), 'eph-nomix-'));
    try {
      await writeFile(join(dir, 'history.json'), '{"kind":"hub-history"}');
      const extras = await historyExtras(await mockRun(), { catalog, policies, historyFrom: dir });
      expect(extras.history.restore.state).toBe('fixture');
      expect(extras.history.entries).toHaveLength(13);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  describe('CLI (temporary output directories only)', () => {
    const tsx = join('node_modules', '.bin', 'tsx');
    const runCli = (args: string[]) =>
      execFileSync(
        tsx,
        ['collector/src/index.ts', '--source', 'mock', '--now', GOLDEN_NOW, ...args],
        {
          encoding: 'utf8',
          env: { ...process.env, HISTORY_FROM: '', HISTORY_RESTORE_STATE: '' },
        },
      );

    it('writes history.json and changes.json and reports the history line', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'eph-cli-'));
      try {
        runCli(['--out', dir]);
        const history = validateHistory(await readFile(join(dir, 'history.json'), 'utf8'));
        expect(history.ok && history.data.entries.length).toBe(13);
        expect(validateChanges(await readFile(join(dir, 'changes.json'), 'utf8')).ok).toBe(true);
        expect(await readFile(join(dir, 'collection-report.md'), 'utf8')).toContain(
          '| History | fixture · 13 entries |',
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('a poisoned history fixture never blocks the snapshots', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'eph-cli-'));
      try {
        const fixture = join(dir, 'history.json');
        await writeFile(
          fixture,
          (await readFile('fixtures/history/history.json', 'utf8')).replace(
            '"0.6.0"',
            '"ghp_exampleSecretValue"',
          ),
        );
        const out2 = join(dir, 'out');
        runCli(['--out', out2, '--history-fixture', fixture]);
        const files = await readdir(out2);
        expect(files).toContain('index.json');
        const history = await readFile(join(out2, 'history.json'), 'utf8');
        expect(history).not.toContain('ghp_exampleSecretValue');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('history.enabled false → no history.json or changes.json written and report says disabled', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'eph-cli-'));
      try {
        const config = join(dir, 'config');
        await cp('config', config, { recursive: true });
        const policiesFile = join(config, 'policies.yaml');
        await writeFile(
          policiesFile,
          `${await readFile(policiesFile, 'utf8')}\nhistory:\n  enabled: false\n`,
        );
        const out2 = join(dir, 'out');
        runCli(['--out', out2, '--config', config]);
        const files = await readdir(out2);
        expect(files).not.toContain('history.json');
        expect(files).not.toContain('changes.json');
        expect(await readFile(join(out2, 'collection-report.md'), 'utf8')).toContain(
          '| History | disabled |',
        );
        expect(
          JSON.parse(await readFile(join(out2, 'collection-report.json'), 'utf8')),
        ).toMatchObject({
          history: null,
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  it('a canary planted in the history fixture is scrubbed, never aborts the run', async () => {
    const { catalog, policies } = await loadConfig('config');
    const dir = await mkdtemp(join(tmpdir(), 'eph-canary-'));
    try {
      const fixture = await readFile('fixtures/history/history.json', 'utf8');
      const result = await mockRun();
      const fields = [
        (t: string, c: string) => t.replace('"2026.10.1"', JSON.stringify(c)),
        (t: string, c: string) => t.replace('"0.6.0"', JSON.stringify(c)),
        (t: string, c: string) =>
          t.replace('"example-org/platform-mono"', JSON.stringify(`example-org/${c}`)),
      ];
      for (const canary of CANARIES) {
        for (const plant of fields) {
          const path = join(dir, 'history.json');
          await writeFile(path, plant(fixture, canary));
          // No catch: a sanitisation abort (no snapshot written) is a failure, not a pass.
          const extras = await historyExtras(result, { catalog, policies, fixturePath: path });
          const text = [
            ...serialise(result.index, result.projects, catalog, result.discovery, extras).values(),
          ].join('\n');
          expect(text).not.toContain(canary);
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('validate-snapshots accepts the golden dir and rejects a history.json with an extra key', async () => {
    const text = await readFile('fixtures/snapshots/history.json', 'utf8');
    expect(validateHistory(text).ok).toBe(true);
    expect(validateChanges(await readFile('fixtures/snapshots/changes.json', 'utf8')).ok).toBe(
      true,
    );
    const bad = JSON.parse(text) as { entries: Record<string, unknown>[] };
    bad.entries[0]!.raw = { headers: {} };
    expect(validateHistory(JSON.stringify(bad))).toMatchObject({
      ok: false,
      error: { kind: 'invalid' },
    });
    // A changes file is never accepted as a history file, and vice versa.
    expect(validateHistory(await readFile('fixtures/snapshots/changes.json', 'utf8')).ok).toBe(
      false,
    );
    expect(HistoryFileSchema.safeParse(JSON.parse(text)).success).toBe(true);
    expect(
      ChangesFileSchema.safeParse(
        JSON.parse(await readFile('fixtures/snapshots/changes.json', 'utf8')),
      ).success,
    ).toBe(true);
  });
});

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

  it('codeQuality capability: a findings 404 is usable, a 403 is not-authorised', async () => {
    const notFound = async () => fail<never>({ classification: 'not-found', httpStatus: 404 });
    const denied = async () => fail<never>({ classification: 'not-authorised', httpStatus: 403 });
    const all404 = await runWith(withQuality({ listCodeQualityFindings: notFound }));
    expect(all404.index.run.capabilities.codeQuality).toBe('available');
    // ...but the findings themselves stay unknown, never 0. (Gamma's repositories are not
    // accessible at all, so its findings stay not-authorised whatever the findings call says.)
    const readableRepos = (projects: ProjectSnapshot[]) =>
      projects.filter((p) => p.project.id !== 'project-gamma');
    for (const p of readableRepos(all404.projects))
      expect(p.qualityHealth.findings.state, p.project.id).toBe('unknown');
    const all403 = await runWith(withQuality({ listCodeQualityFindings: denied }));
    expect(all403.index.run.capabilities.codeQuality).toBe('not-authorised');
    for (const p of all403.projects)
      expect(p.qualityHealth.findings.state, p.project.id).toBe('not-authorised');
  });

  it('codeQuality capability: a findings page-cap hit still proves the permission', async () => {
    const capped = async () =>
      fail<never>({
        classification: 'error',
        message: 'FindingsPageCapExceeded',
        incomplete: true,
      });
    const { index, projects } = await runWith(withQuality({ listCodeQualityFindings: capped }));
    expect(index.run.capabilities.codeQuality).toBe('available');
    for (const p of projects.filter((x) => x.project.id !== 'project-gamma'))
      expect(p.qualityHealth.findings.state, p.project.id).toBe('unknown');
  });

  it('a "not configured" findings message skips that repository', async () => {
    const notEnabled = async () =>
      fail<never>({ classification: 'not-configured', httpStatus: 404 });
    const { index, projects } = await runWith(withQuality({ listCodeQualityFindings: notEnabled }));
    expect(index.run.capabilities.codeQuality).toBe('available');
    for (const p of projects.filter((x) => x.project.id !== 'project-gamma'))
      expect(p.qualityHealth.findings.state, p.project.id).toBe('not-configured');
  });

  it('alpha findings 0 / 3: helm (no Code Quality) has an empty list (spec §5.8)', async () => {
    const { projects } = await mockRun();
    const alpha = byId(projects)['project-alpha']!;
    expect(alpha.qualityHealth.findings).toMatchObject({
      state: 'available',
      reliability: 0,
      maintainability: 3,
    });
    // Platform's findings 404 is unknown, never 0.
    expect(byId(projects)['platform']!.qualityHealth.findings.state).toBe('unknown');
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
    getLatestScorecardAnalysis: async () => ok(null),
    getBranchRules: async () => ok([]),
    getClassicBranchProtection: async () => ok(null),
    getCustomPropertyValues: async () => ok([]),
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
      '"schemaVersion": "1.5"',
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

describe('repository controls (mock run)', () => {
  const byId = async () => {
    const { projects, index } = await mockRun();
    return {
      index,
      projects: Object.fromEntries(projects.map((p) => [p.project.id, p])) as Record<
        string,
        ProjectSnapshot
      >,
    };
  };
  const counts = (p: ProjectSnapshot) => {
    const { passed, failed, unknown, notApplicable, ratio } = p.repositoryControls;
    return { passed, failed, unknown, notApplicable, ratio };
  };
  const repoOf = (p: ProjectSnapshot, name: string) =>
    p.repositoryControls.repositories.find((r) => r.repository === `example-org/${name}`)!;
  const states = (p: ProjectSnapshot, name: string) => repoOf(p, name).checks.map((c) => c.state);

  it('writes snapshot schema 1.5', async () => {
    const { index, projects } = await byId();
    expect(index.schemaVersion).toBe('1.5');
    for (const p of Object.values(projects)) expect(p.schemaVersion).toBe('1.5');
  });

  it('counts the checks per project over unique repositories', async () => {
    const { projects } = await byId();
    expect(counts(projects['project-alpha']!)).toEqual({
      passed: 25,
      failed: 0,
      unknown: 0,
      notApplicable: 5,
      ratio: 100,
    });
    expect(counts(projects['project-beta']!)).toEqual({
      passed: 5,
      failed: 7,
      unknown: 8,
      notApplicable: 4,
      ratio: 42,
    });
    expect(counts(projects['platform']!)).toEqual({
      passed: 4,
      failed: 1,
      unknown: 1,
      notApplicable: 0,
      ratio: 80,
    });
    expect(counts(projects['project-gamma']!)).toEqual({
      passed: 0,
      failed: 0,
      unknown: 12,
      notApplicable: 0,
      ratio: null,
    });
  });

  it('evaluates the monorepo once, listing every target on it', async () => {
    const { projects } = await byId();
    const platform = projects['platform']!;
    expect(platform.repositoryControls.repositories).toHaveLength(1);
    expect(platform.repositoryControls.repositories[0]!.componentIds).toEqual([
      'coordinator',
      'web',
      'api',
      'worker',
    ]);
  });

  it('beta: check states per repository, in spec order', async () => {
    const { projects } = await byId();
    const beta = projects['project-beta']!;
    expect(states(beta, 'project-beta-coordinator')).toEqual([
      'fail',
      'fail',
      'pass',
      'unknown',
      'unknown',
      'unknown',
    ]);
    expect(states(beta, 'project-beta-api')).toEqual([
      'fail',
      'not-applicable',
      'pass',
      'pass',
      'unknown',
      'pass',
    ]);
    expect(states(beta, 'project-beta-web')).toEqual([
      'pass',
      'not-applicable',
      'fail',
      'fail',
      'fail',
      'fail',
    ]);
    expect(states(beta, 'project-beta-helm')).toEqual([
      'not-applicable',
      'not-applicable',
      'unknown',
      'unknown',
      'unknown',
      'unknown',
    ]);
  });

  it('beta-api counts its actions but withholds the identifiers of a private repository', async () => {
    const { projects } = await byId();
    const api = repoOf(projects['project-beta']!, 'project-beta-api');
    expect(api.actions).toMatchObject({
      state: 'available',
      workflowFiles: 1,
      total: 4,
      pinned: 2,
      unpinned: 2,
      unknown: 0,
      detailsWithheld: true,
      unpinnedRefs: [],
      truncated: 0,
    });
    expect(api.branchRules).toMatchObject({
      state: 'available',
      protected: true,
      source: 'rulesets',
      requiredApprovals: 1,
      ruleTypes: ['pull_request', 'required_status_checks'],
    });
  });

  it('lists the unpinned references of a public repository', async () => {
    const { projects } = await byId();
    const mono = projects['platform']!.repositoryControls.repositories[0]!;
    expect(mono.actions).toMatchObject({
      total: 4,
      pinned: 1,
      unpinned: 3,
      detailsWithheld: false,
    });
    expect(mono.actions.unpinnedRefs.map((r) => `${r.workflow} ${r.target}@${r.ref}`)).toEqual([
      'ci.yml pnpm/action-setup@v4',
      'docs.yml example-private/templates/.github/workflows/docs.yml@v1.0.0',
      'release.yml example-shared/ci-templates/.github/workflows/release.yml@main',
    ]);
  });

  it('beta coordinator is behind the latest release of the shared templates', async () => {
    const { projects } = await byId();
    const coordinator = repoOf(projects['project-beta']!, 'project-beta-coordinator');
    expect(coordinator.reusableWorkflows[0]).toEqual({
      workflow: 'release.yml',
      target: 'example-shared/ci-templates/.github/workflows/build.yml',
      ref: 'v2.1.0',
      latest: 'v2.4.0',
      status: 'behind',
      url: 'https://github.com/example-shared/ci-templates',
    });
  });

  it('platform: a floating branch and a not visible template repository', async () => {
    const { projects } = await byId();
    const mono = projects['platform']!.repositoryControls.repositories[0]!;
    const status = (file: string) => mono.reusableWorkflows.find((r) => r.workflow === file)!;
    expect(status('release.yml')).toMatchObject({ ref: 'main', status: 'floating' });
    expect(status('docs.yml')).toMatchObject({ ref: 'v1.0.0', status: 'unknown', url: null });
  });

  it('scorecard summary per repository', async () => {
    const { projects } = await byId();
    expect(repoOf(projects['project-beta']!, 'project-beta-api').scorecard).toMatchObject({
      state: 'available',
      openAlerts: 2,
      failingChecks: ['Token-Permissions', 'Pinned-Dependencies'],
      otherFailing: 0,
    });
    expect(repoOf(projects['project-alpha']!, 'project-alpha-backend').scorecard).toMatchObject({
      state: 'available',
      openAlerts: 0,
      failingChecks: [],
    });
    expect(repoOf(projects['project-beta']!, 'project-beta-web').scorecard.state).toBe('not-used');
  });

  it('governance and overall status of every project are unchanged by default', async () => {
    const { projects } = await byId();
    const status = (id: string) => [
      projects[id]!.governanceHealth.status,
      projects[id]!.overallHealth.status,
    ];
    expect(status('platform')).toEqual(['green', 'amber']);
    expect(status('project-alpha')).toEqual(['green', 'amber']);
    expect(status('project-beta')).toEqual(['amber', 'red']);
    expect(status('project-gamma')).toEqual(['grey', 'grey']);
  });

  it('shows failing checks in governance as info reasons only', async () => {
    const { projects } = await byId();
    const reasons = projects['project-beta']!.governanceHealth.reasons.filter((r) =>
      r.code.startsWith('repository-check'),
    );
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.every((r) => r.level === 'info')).toBe(true);
  });

  it('records the repository-rules capability as partial (beta-helm answers 403)', async () => {
    const { index } = await byId();
    expect(index.run.capabilities.repositoryRules).toBe('partial');
  });

  it('records collection errors only for monitored repositories', async () => {
    const { projects } = await byId();
    const errors = Object.values(projects).flatMap((p) => p.collectionErrors);
    expect(
      errors.some((e) => e.source === 'repository-rules' && e.repository.endsWith('beta-helm')),
    ).toBe(true);
    expect(errors.some((e) => /ci-templates|example-private/.test(e.repository))).toBe(false);
    expect(errors.some((e) => e.source === 'workflow-files')).toBe(false);
  });

  it('summary.repositoryControls equals the snapshot counts for each project', async () => {
    const { projects, index } = await byId();
    for (const summary of index.projects) {
      expect(summary.repositoryControls).toEqual(counts(projects[summary.id]!));
    }
  });

  it('never publishes workflow text or an unconfigured custom property', async () => {
    const result = await mockRun();
    const { catalog, policies } = await loadConfig('config');
    const dir = await mkdtemp(join(tmpdir(), 'eph-controls-'));
    try {
      const extras = await historyExtras(result, { catalog, policies });
      await writeSnapshots(dir, result.index, result.projects, catalog, result.discovery, extras);
      const files = [
        'index.json',
        'catalog.json',
        'collection-report.json',
        'collection-report.md',
        'history.json',
        'changes.json',
        ...(await readdir(join(dir, 'projects'))).map((f) => `projects/${f}`),
      ];
      for (const f of files) {
        const text = await readFile(join(dir, f), 'utf8');
        for (const marker of ['marker-step-7f3e', 'marker-run-7f3e', 'CC-1234'])
          expect(text, `${marker} in ${f}`).not.toContain(marker);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('a monorepo check is not applicable only when every target lists it', async () => {
    const { catalog, policies } = await loadConfig('config');
    const clock = fixedClock(GOLDEN_NOW);
    const run = async (mutate: (p: Catalog['projects'][number]) => void) => {
      const c = structuredClone(catalog);
      mutate(c.projects.find((p) => p.id === 'platform')!);
      const result = await runCollection({
        catalog: c,
        policies,
        provider: new MockProvider('fixtures/github', clock),
        clock,
      });
      const platform = result.projects.find((p) => p.project.id === 'platform')!;
      return platform.repositoryControls.repositories[0]!.checks.find(
        (x) => x.id === 'status-checks-required',
      )!.state;
    };
    expect(
      await run((p) => {
        p.coordinator.notApplicableChecks = ['status-checks-required'];
      }),
    ).toBe('pass');
    expect(
      await run((p) => {
        p.coordinator.notApplicableChecks = ['status-checks-required'];
        for (const c of p.components) c.notApplicableChecks = ['status-checks-required'];
      }),
    ).toBe('not-applicable');
  });

  it('does not make any repository-controls call when the block is disabled', async () => {
    const { catalog, policies } = await loadConfig('config');
    policies.repositoryControls.enabled = false;
    const clock = fixedClock(GOLDEN_NOW);
    const inner = new MockProvider('fixtures/github', clock);
    const called: string[] = [];
    const watch = new Proxy(inner, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (typeof v !== 'function') return v;
        return (...args: unknown[]) => {
          called.push(String(prop));
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const result = await runCollection({ catalog, policies, provider: watch, clock });
    for (const name of [
      'getBranchRules',
      'getClassicBranchProtection',
      'getLatestScorecardAnalysis',
    ])
      expect(called, name).not.toContain(name);
    expect(result.index.run.capabilities.repositoryRules).toBe('not-used');
    for (const p of result.projects) {
      expect(p.repositoryControls).toMatchObject({ enabled: false, repositories: [], ratio: null });
      expect(p.governanceHealth.reasons.some((r) => r.code.startsWith('repository-check'))).toBe(
        false,
      );
    }
  });

  it('makes the classic protection call only when readClassicProtection is on', async () => {
    const { catalog, policies } = await loadConfig('config');
    const clock = fixedClock(GOLDEN_NOW);
    const classicCalls = async (flag: boolean) => {
      const p = structuredClone(policies);
      p.repositoryControls.readClassicProtection = flag;
      const inner = new MockProvider('fixtures/github', clock);
      let n = 0;
      const watch = new Proxy(inner, {
        get(target, prop, receiver) {
          const v = Reflect.get(target, prop, receiver);
          if (prop !== 'getClassicBranchProtection' || typeof v !== 'function') return v;
          return (...args: unknown[]) => {
            n++;
            return (v as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
      await runCollection({ catalog, policies: p, provider: watch, clock });
      return n;
    };
    expect(await classicCalls(false)).toBe(0);
    expect(await classicCalls(true)).toBeGreaterThan(0);
  });
});
