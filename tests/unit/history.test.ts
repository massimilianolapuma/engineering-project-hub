import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  PortfolioIndexSchema,
  ProjectSnapshotSchema,
  type Catalog,
  type HistoryFile,
  type PortfolioIndex,
  type Policies,
  type ProjectSnapshot,
} from '@model/index';
import { loadConfig } from '../../collector/src/config/load';
import { appendHistory, entryFromRun, fitHistory } from '../../collector/src/history/append';
import { buildBaseline } from '../../collector/src/history/baseline';
import { computeChanges } from '../../collector/src/history/changes';
import {
  cleanHistory,
  HISTORY_MAX_BYTES,
  historyDir,
  loadPreviousHistory,
  type CleanHistory,
  type LoadHistoryOptions,
  type PreviousHistory,
} from '../../collector/src/history/load';
import { serialise, SnapshotValidationError } from '../../collector/src/writers/write-snapshots';
import { CANARIES } from '../helpers/canaries';
import {
  daysAgo,
  historyEntry,
  historyFile,
  historyPoint,
  NOW,
  policies as loadPolicies,
  projectSummary,
} from '../helpers/factories';

let catalog: Catalog;
let policies: Policies;
const dirs: string[] = [];

beforeAll(async () => {
  ({ catalog, policies } = await loadConfig('config'));
});
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'eph-history-'));
  dirs.push(d);
  return d;
}

const GOLDEN_INDEX = PortfolioIndexSchema.parse(
  JSON.parse(readFileSync('fixtures/snapshots/index.json', 'utf8')),
);
const goldenProject = (id: string): ProjectSnapshot =>
  ProjectSnapshotSchema.parse(
    JSON.parse(readFileSync(`fixtures/snapshots/projects/${id}.json`, 'utf8')),
  );

/** A deep copy of one golden project with its summary, ready to mutate. */
function runOf(id: string): { index: PortfolioIndex; project: ProjectSnapshot } {
  const index = structuredClone(GOLDEN_INDEX);
  index.projects = index.projects.filter((p) => p.id === id);
  return { index, project: structuredClone(goldenProject(id)) };
}

/** Writes a history.json (or raw text) and loads it as a github run. */
async function loadGithub(
  content: HistoryFile | string | null,
  extra: Partial<LoadHistoryOptions> = {},
): Promise<PreviousHistory> {
  const dir = await tmp();
  if (content !== null)
    await writeFile(
      join(dir, 'history.json'),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  return loadPreviousHistory({
    dataSource: 'github',
    historyFrom: dir,
    fixturePath: join(dir, 'no-fixture.json'),
    catalog,
    policies,
    now: NOW,
    ...extra,
  });
}

/** A valid history of project-alpha, newest entry one day old. */
const githubHistory = (): HistoryFile =>
  historyFile([historyEntry(daysAgo(2)), historyEntry(daysAgo(1))]);

describe('historyDir', () => {
  it('flag, then $HISTORY_FROM, then --out; an empty value falls through', () => {
    expect(historyDir('a', 'b', 'out')).toBe('a');
    expect(historyDir(undefined, 'b', 'out')).toBe('b');
    expect(historyDir(undefined, undefined, 'out')).toBe('out');
    expect(historyDir(undefined, '', 'out')).toBe('out');
    expect(historyDir('', '', 'out')).toBe('out');
  });
});

describe('loadPreviousHistory', () => {
  it('mock source reads the fixture and resolves @now-12d to 2026-01-03T12:00:00.000Z', async () => {
    const dir = await tmp();
    const fixturePath = join(dir, 'fixture.json');
    const file = historyFile([
      historyEntry('@now-12d', { dataSource: 'mock', authenticationMode: 'mock' }),
      historyEntry('@now-1d', { dataSource: 'mock', authenticationMode: 'mock' }),
    ]);
    await writeFile(fixturePath, JSON.stringify(file));
    const r = await loadPreviousHistory({
      dataSource: 'mock',
      historyFrom: dir,
      fixturePath,
      catalog,
      policies,
      now: NOW,
    });
    expect(r.state).toBe('fixture');
    expect(r.file?.entries.map((e) => e.collectedAt)).toEqual([
      '2026-01-03T12:00:00.000Z',
      '2026-01-14T12:00:00.000Z',
    ]);
    expect(r.file?.baseline?.collectedAt).toBe('2026-01-14T12:00:00.000Z');
  });

  it('mock source ignores historyFrom even when it holds a valid github history', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'history.json'), JSON.stringify(githubHistory()));
    const r = await loadPreviousHistory({
      dataSource: 'mock',
      historyFrom: dir,
      fixturePath: join(dir, 'missing-fixture.json'),
      catalog,
      policies,
      now: NOW,
    });
    expect(r).toEqual({ state: 'none', file: null });
  });

  it('github: restoreState "failed" → restore-failed, even when a valid file exists', async () => {
    expect((await loadGithub(githubHistory(), { restoreState: 'failed' })).state).toBe(
      'restore-failed',
    );
  });

  it('github: restoreState "none" → none', async () => {
    expect((await loadGithub(githubHistory(), { restoreState: 'none' })).state).toBe('none');
  });

  it('github: no file → none', async () => {
    expect(await loadGithub(null)).toEqual({ state: 'none', file: null });
  });

  it('github: file of 8_388_609 bytes → unreadable', async () => {
    const r = await loadGithub(' '.repeat(HISTORY_MAX_BYTES + 1));
    expect(r.state).toBe('unreadable');
  });

  it('github: "not json" → unreadable', async () => {
    expect((await loadGithub('not json')).state).toBe('unreadable');
  });

  it('github: kind hub-changes → unreadable', async () => {
    const f = { ...githubHistory(), kind: 'hub-changes' };
    expect((await loadGithub(JSON.stringify(f))).state).toBe('unreadable');
  });

  it('github: schemaVersion "9.9" → incompatible', async () => {
    const f = { ...githubHistory(), schemaVersion: '9.9' };
    expect((await loadGithub(JSON.stringify(f))).state).toBe('incompatible');
  });

  it('github: last entry dataSource mock → source-changed', async () => {
    const f = historyFile([historyEntry(daysAgo(1), { dataSource: 'mock' })]);
    expect((await loadGithub(f)).state).toBe('source-changed');
  });

  it('github: older mock entries are dropped with a note; the github entries are restored', async () => {
    const previous = await loadGithub(
      historyFile([
        historyEntry(daysAgo(3), { dataSource: 'mock', authenticationMode: 'mock' }),
        historyEntry(daysAgo(2)),
        historyEntry(daysAgo(1)),
      ]),
    );
    expect(previous.state).toBe('restored');
    expect(previous.file?.entries.map((e) => e.collectedAt)).toEqual([daysAgo(2), daysAgo(1)]);
    expect(previous.file?.entries.every((e) => e.dataSource === 'github')).toBe(true);
    expect(previous.state === 'restored' && previous.notes).toEqual([
      'Dropped 1 earlier collection from another data source (mock) from the restored history.',
    ]);
  });

  it('github: valid file → restored with its entries', async () => {
    const r = await loadGithub(githubHistory());
    expect(r.state).toBe('restored');
    expect(r.file?.entries).toHaveLength(2);
  });

  it('fresh true → none', async () => {
    expect((await loadGithub(githubHistory(), { fresh: true })).state).toBe('none');
  });
});

describe('poisoned restored history', () => {
  it('never aborts the run and never reaches the published files', async () => {
    for (const canary of CANARIES) {
      const file = githubHistory();
      file.entries[0]!.collectorVersion = canary;
      file.baseline.projects[0]!.findings = [
        {
          id: 'example-org/x#dependabot#2',
          severity: 'high',
          componentId: 'backend',
          repository: `example-org/${canary}`,
          source: 'github-dependabot',
          htmlUrl: null,
        },
      ];
      const previous = await loadGithub(file);
      const r = runOf('project-alpha');
      r.index.generatedAt = NOW.toISOString();
      r.index.run.dataSource = 'github';
      const extras = {
        history: appendHistory(previous, r.index, [r.project], catalog, policies, NOW),
        changes: computeChanges(previous, r.index, [r.project]),
      };
      const text = [...serialise(r.index, [r.project], undefined, null, extras).values()].join(
        '\n',
      );
      for (const c of CANARIES) expect(text).not.toContain(c);
    }
  });
});

describe('timestamps', () => {
  const idx = (generatedAt: string): PortfolioIndex => ({
    ...structuredClone(GOLDEN_INDEX),
    generatedAt,
  });

  it('a restored file with an offset timestamp out of order never crashes the append', async () => {
    const file = historyFile([
      historyEntry('2026-01-14T05:00:00Z'),
      historyEntry('2026-01-14T09:00:00+05:00'), // 04:00Z: earlier, though larger as a string
    ]);
    const previous = await loadGithub(file);
    expect(previous.state).toBe('unreadable');
    expect(() =>
      appendHistory(previous, idx(NOW.toISOString()), [], catalog, policies, NOW),
    ).not.toThrow();
  });

  it('orders entries by instant, not by string: 12:00:00Z then 12:00:00.500Z is restored', async () => {
    const previous = await loadGithub(
      historyFile([historyEntry('2026-01-14T12:00:00Z'), historyEntry('2026-01-14T12:00:00.500Z')]),
    );
    expect(previous.state).toBe('restored');
    const h = appendHistory(previous, idx(NOW.toISOString()), [], catalog, policies, NOW);
    expect(h.entries.map((e) => e.collectedAt)).toEqual([
      '2026-01-14T12:00:00.000Z',
      '2026-01-14T12:00:00.500Z',
      NOW.toISOString(),
    ]);
  });

  it('a run timestamp with an offset is written in UTC', () => {
    const h = appendHistory(
      { state: 'none', file: null },
      idx('2026-01-15T17:00:00+05:00'),
      [],
      catalog,
      policies,
      NOW,
    );
    expect(h.entries[0]!.collectedAt).toBe(NOW.toISOString());
    expect(h.baseline.collectedAt).toBe(NOW.toISOString());
    expect(h.generatedAt).toBe(NOW.toISOString());
  });
});

describe('cleanHistory', () => {
  const clean = (f: HistoryFile): CleanHistory => cleanHistory(f, catalog, policies, NOW);

  it('drops an entry dated at or after now', () => {
    const f = clean(
      historyFile([
        historyEntry(daysAgo(1)),
        historyEntry(NOW.toISOString()),
        historyEntry('2026-01-16T12:00:00.000Z'),
      ]),
    );
    expect(f.entries.map((e) => e.collectedAt)).toEqual([daysAgo(1)]);
    // The baseline described the last (dropped) entry: no longer usable.
    expect(f.baseline).toBeNull();
  });

  it('de-duplicates two entries with the same collectedAt', () => {
    const e = historyEntry(daysAgo(1));
    expect(clean(historyFile([e, structuredClone(e)])).entries).toHaveLength(1);
  });

  it('removes project "retired" not in the catalog and drops an entry left empty', () => {
    const f = clean(
      historyFile([
        historyEntry(daysAgo(2), { projects: [historyPoint({ id: 'retired' })] }),
        historyEntry(daysAgo(1), {
          projects: [historyPoint({ id: 'retired' }), historyPoint()],
        }),
      ]),
    );
    expect(f.entries).toHaveLength(1);
    expect(f.entries[0]!.projects.map((p) => p.id)).toEqual(['project-alpha']);
    expect(f.baseline?.projects.map((p) => p.id)).toEqual(['project-alpha']);
  });

  it('baseline htmlUrl on host evil.example becomes null', () => {
    const file = historyFile();
    file.baseline.projects[0]!.findings = [
      {
        id: 'example-org/x#code-scanning#1',
        severity: 'high',
        componentId: 'backend',
        repository: 'example-org/x',
        source: 'github-code-scanning',
        htmlUrl: 'https://evil.example/security/1',
      },
      {
        id: 'example-org/x#code-scanning#2',
        severity: 'high',
        componentId: 'backend',
        repository: 'example-org/x',
        source: 'github-code-scanning',
        htmlUrl: 'https://github.com/example-org/x/security/code-scanning/2',
      },
    ];
    const urls = clean(file).baseline?.projects[0]!.findings.map((f) => f.htmlUrl);
    expect(urls).toEqual([null, 'https://github.com/example-org/x/security/code-scanning/2']);
  });

  it('canaries in a restored collectorVersion, baseline componentId or repository never reach the output', () => {
    const poison = [...CANARIES, '<img src=x onerror=alert(1)>'];
    for (const canary of poison) {
      const file = historyFile([
        historyEntry(daysAgo(2), { collectorVersion: canary }),
        historyEntry(daysAgo(1)),
      ]);
      const finding = {
        severity: 'high' as const,
        source: 'github-dependabot' as const,
        htmlUrl: null,
      };
      file.baseline.projects[0]!.findings = [
        {
          ...finding,
          id: 'example-org/x#dependabot#1',
          componentId: canary,
          repository: 'example-org/x',
        },
        {
          ...finding,
          id: 'example-org/x#dependabot#2',
          componentId: 'backend',
          repository: `example-org/${canary}`,
        },
        {
          ...finding,
          id: 'example-org/x#dependabot#3',
          componentId: 'backend',
          repository: canary,
        },
      ];
      const text = JSON.stringify(clean(file));
      for (const c of poison) expect(text).not.toContain(c);
    }
  });

  it('a canary in a restored baseline version is scrubbed', () => {
    for (const canary of CANARIES) {
      const file = historyFile();
      file.baseline.projects[0]!.versions = [
        { kind: 'coordinator', componentId: null, version: canary },
      ];
      const result = clean(file);
      const text = JSON.stringify(result);
      for (const c of CANARIES) expect(text).not.toContain(c);
    }
  });
});

describe('appendHistory', () => {
  const index = (): PortfolioIndex => ({
    ...structuredClone(GOLDEN_INDEX),
    generatedAt: NOW.toISOString(),
  });
  const restored = (offsetsDays: number[]): PreviousHistory => ({
    state: 'restored',
    file: cleanHistory(
      historyFile(offsetsDays.map((d) => historyEntry(daysAgo(d)))),
      catalog,
      policies,
      NOW,
    ),
  });
  const append = (previous: PreviousHistory, p: Policies = policies) =>
    appendHistory(previous, index(), [], catalog, p, NOW);

  it('a project with 250 components keeps the first 200 versions instead of failing', () => {
    const { project } = runOf('project-alpha');
    const c0 = project.components[0]!;
    for (let n = 0; n < 250; n++) project.components.push({ ...c0, id: `c${n}` });
    const h = appendHistory(
      { state: 'none', file: null },
      index(),
      [project],
      catalog,
      policies,
      NOW,
    );
    expect(h.baseline.projects[0]!.versions).toHaveLength(200);
  });

  it('a schema failure is a SnapshotValidationError that names the failing path', () => {
    const big = index();
    const s0 = big.projects[0]!;
    big.projects = Array.from({ length: 501 }, (_, n) => ({ ...s0, id: `p${n}` }));
    expect(() =>
      appendHistory({ state: 'none', file: null }, big, [], catalog, policies, NOW),
    ).toThrow(SnapshotValidationError);
    expect(() =>
      appendHistory({ state: 'none', file: null }, big, [], catalog, policies, NOW),
    ).toThrow(/entries\[0\]\.projects/);
  });

  it('fitHistory drops the oldest entries until the file fits the read cap; the current entry stays', () => {
    const h = append(restored([5, 4, 3, 2, 1]));
    const size = (f: HistoryFile) => Buffer.byteLength(`${JSON.stringify(f)}\n`);
    const full = size(h);
    const one = Buffer.byteLength(JSON.stringify(h.entries[0])) + 1;
    const fitted = fitHistory(h, full - one);
    expect(fitted.dropped).toBe(1);
    expect(fitted.file.entries).toHaveLength(5);
    expect(fitted.file.restore.previousEntries).toBe(4);
    expect(size(fitted.file)).toBeLessThanOrEqual(full - one);
    expect(fitted.file.entries.at(-1)!.collectedAt).toBe(NOW.toISOString());
    const tiny = fitHistory(h, 10);
    expect(tiny.file.entries).toHaveLength(1);
    expect(tiny.fits).toBe(false);
    expect(fitHistory(h).dropped).toBe(0);
  });

  it('maxAgeDays 90: entries at now-100d, now-80d, now-1d + current → 3 entries (now-80d, now-1d, now)', () => {
    const f = append(restored([100, 80, 1]));
    expect(f.entries.map((e) => e.collectedAt)).toEqual([
      daysAgo(80),
      daysAgo(1),
      NOW.toISOString(),
    ]);
    expect(f.restore).toEqual({ state: 'restored', previousEntries: 2 });
    expect(f.retention).toEqual({ maxEntries: 120, maxAgeDays: 90 });
  });

  it('maxEntries 3: 5 previous + current → the last 3, current last', () => {
    const p = loadPolicies((x) => {
      x.history.maxEntries = 3;
    });
    const f = append(restored([5, 4, 3, 2, 1]), p);
    expect(f.entries.map((e) => e.collectedAt)).toEqual([
      daysAgo(2),
      daysAgo(1),
      NOW.toISOString(),
    ]);
    expect(f.baseline.collectedAt).toBe(NOW.toISOString());
  });

  it('fresh state → 1 entry, restore.previousEntries 0', () => {
    const f = append({ state: 'restore-failed', file: null });
    expect(f.entries).toHaveLength(1);
    expect(f.restore).toEqual({ state: 'restore-failed', previousEntries: 0 });
  });

  it('entryFromRun maps summary fields', () => {
    const i = index();
    i.projects = [
      projectSummary({
        score: { value: 40, measured: 6, required: 6 },
        openCounts: { critical: 1, high: 2, medium: null, low: 4, informational: 0, unknown: 0 },
        collectionErrorCount: 3,
        countsComplete: false,
        overall: 'red',
        delivery: 'amber',
        coverage: { status: 'red', percentage: 10, required: 4, available: 1 },
        quality: { status: 'grey', percentage: null, measured: 0, applicable: 0 },
      }),
    ];
    expect(entryFromRun(i).projects[0]).toEqual({
      id: 'project-alpha',
      overall: 'red',
      score: 40,
      scoreMeasured: 6,
      scoreRequired: 6,
      dimensions: {
        delivery: 'amber',
        version: 'green',
        security: 'green',
        coverage: 'red',
        governance: 'green',
        quality: 'grey',
      },
      open: { critical: 1, high: 2, medium: null, low: 4 },
      countsComplete: false,
      collectionErrors: 3,
      controls: { passed: 6, failed: 0, unknown: 0 },
    });
  });

  it('buildBaseline: beta-like snapshot has unreadable ["example-org/project-beta-api|secret-scanning", …] and errors keys "repo|secret-scanning|not-authorised"', () => {
    const { index: i, project } = runOf('project-beta');
    const b = buildBaseline(i, [project]).projects[0]!;
    expect(b.unreadable).toEqual([
      'example-org/project-beta-api|secret-scanning',
      'example-org/project-beta-coordinator|secret-scanning',
      'example-org/project-beta-web|secret-scanning',
    ]);
    expect(b.errors).toContain('example-org/project-beta-api|secret-scanning|not-authorised');
    expect(b.findings.map((f) => f.id)).toEqual([
      'example-org/project-beta-api#code-scanning#3',
      'example-org/project-beta-api#code-scanning#901',
      'example-org/project-beta-web#dependabot#11',
    ]);
    expect(b.versions).toContainEqual({ kind: 'component', componentId: 'api', version: '3.1.0' });
  });

  it('buildBaseline: a repository error marks code-scanning, dependabot, secret-scanning and security-status-file unreadable for that repo', () => {
    const { index: i, project } = runOf('project-alpha');
    project.collectionErrors = [
      { repository: 'example-org/r', source: 'repository', classification: 'not-found' },
    ];
    expect(buildBaseline(i, [project]).projects[0]!.unreadable).toEqual([
      'example-org/r|code-scanning',
      'example-org/r|dependabot',
      'example-org/r|secret-scanning',
      'example-org/r|security-status-file',
    ]);
  });
});

describe('computeChanges', () => {
  /** Repositories alpha monitors in the golden run. */
  const alphaRepos = goldenProject('project-alpha').securityControls.map((c) => c.repository);
  /** Alpha's current dimensions, as a history point, so a test only overrides what differs. */
  const alphaNow = () => {
    const s = GOLDEN_INDEX.projects.find((p) => p.id === 'project-alpha')!;
    return historyPoint({
      overall: s.overall,
      score: s.score.value,
      dimensions: {
        delivery: s.delivery,
        version: s.version,
        security: s.security,
        coverage: s.coverage.status,
        governance: s.governance,
        quality: s.quality.status,
      },
    });
  };
  const previousOf = (
    point = alphaNow(),
    baseline: Partial<NonNullable<CleanHistory['baseline']>['projects'][number]> = {},
    state: 'restored' | 'fixture' = 'restored',
  ): PreviousHistory => {
    const file = historyFile([historyEntry(daysAgo(1), { projects: [point] })]);
    file.baseline.projects[0] = {
      ...file.baseline.projects[0]!,
      repositories: alphaRepos,
      ...baseline,
    };
    return { state, file };
  };
  const changesFor = (
    previous: PreviousHistory,
    mutate?: (r: ReturnType<typeof runOf>) => void,
  ) => {
    const r = runOf('project-alpha');
    mutate?.(r);
    return computeChanges(previous, r.index, [r.project]);
  };
  const alphaOf = (c: ReturnType<typeof computeChanges>) => c.projects[0]!;
  const dependabot7 = {
    id: 'example-org/project-alpha-frontend#dependabot#7',
    severity: 'high' as const,
    componentId: 'frontend',
    repository: 'example-org/project-alpha-frontend',
    source: 'github-dependabot' as const,
    htmlUrl: null,
  };
  const versionsNow = [
    { kind: 'coordinator' as const, componentId: null, version: '1.4.0' },
    { kind: 'component' as const, componentId: 'backend', version: '1.4.0' },
    { kind: 'component' as const, componentId: 'frontend', version: '2.1.0' },
  ];

  it('status: amber → red overall and delivery, in order overall, delivery', () => {
    const prev = alphaNow();
    prev.overall = 'amber';
    prev.dimensions.delivery = 'amber';
    const c = changesFor(previousOf(prev), ({ index }) => {
      index.projects[0]!.overall = 'red';
      index.projects[0]!.delivery = 'red';
    });
    expect(alphaOf(c).statusChanges).toEqual([
      { dimension: 'overall', from: 'amber', to: 'red' },
      { dimension: 'delivery', from: 'amber', to: 'red' },
    ]);
    expect(c.totals.statusChanges).toBe(2);
  });

  it('grey → green counts as a change', () => {
    const prev = alphaNow();
    prev.dimensions.quality = 'grey';
    const c = changesFor(previousOf(prev));
    expect(alphaOf(c).statusChanges).toEqual([{ dimension: 'quality', from: 'grey', to: 'green' }]);
  });

  it('a dimension missing in the previous point is not compared', () => {
    const prev = alphaNow();
    delete prev.dimensions.quality;
    expect(alphaOf(changesFor(previousOf(prev))).statusChanges).toEqual([]);
  });

  it('new high alert when its pair was readable before', () => {
    const c = changesFor(previousOf(alphaNow(), { findings: [] }));
    const p = alphaOf(c);
    expect(p.newFindings.map((f) => f.id)).toEqual([dependabot7.id]);
    expect(p.newFindings[0]!.title).toContain('Prototype pollution');
    expect(p.findingsPartial).toBe(false);
    expect(c.totals.newFindings).toBe(1);
  });

  it('not new when its pair was unreadable in the previous run; findingsPartial true', () => {
    const c = changesFor(
      previousOf(alphaNow(), { unreadable: ['example-org/project-alpha-frontend|dependabot'] }),
    );
    expect(alphaOf(c).newFindings).toEqual([]);
    expect(alphaOf(c).findingsPartial).toBe(true);
  });

  it('resolved when absent now and its pair readable now', () => {
    const gone = { ...dependabot7, id: 'example-org/project-alpha-backend#code-scanning#9' };
    const c = changesFor(previousOf(alphaNow(), { findings: [dependabot7, gone] }));
    expect(alphaOf(c).resolvedFindings.map((f) => f.id)).toEqual([gone.id]);
    expect(alphaOf(c).newFindings).toEqual([]);
    expect(c.totals.resolvedFindings).toBe(1);
  });

  it('not resolved when its pair is unreadable now; findingsPartial true', () => {
    const gone = {
      ...dependabot7,
      id: 'example-org/project-alpha-backend#code-scanning#9',
      repository: 'example-org/project-alpha-backend',
      source: 'github-code-scanning' as const,
    };
    const c = changesFor(
      previousOf(alphaNow(), { findings: [dependabot7, gone] }),
      ({ project }) => {
        project.collectionErrors.push({
          repository: 'example-org/project-alpha-backend',
          source: 'code-scanning',
          classification: 'not-authorised',
        });
      },
    );
    expect(alphaOf(c).resolvedFindings).toEqual([]);
    expect(alphaOf(c).findingsPartial).toBe(true);
  });

  it('a component removed from the catalog: its baseline alerts are not resolved; findingsPartial true', () => {
    const legacy = {
      ...dependabot7,
      id: 'example-org/project-alpha-legacy#dependabot#5',
      severity: 'critical' as const,
      componentId: 'legacy',
      repository: 'example-org/project-alpha-legacy',
    };
    const c = changesFor(
      previousOf(alphaNow(), {
        findings: [dependabot7, legacy],
        repositories: [...alphaRepos, 'example-org/project-alpha-legacy'],
      }),
    );
    expect(alphaOf(c).resolvedFindings).toEqual([]);
    expect(alphaOf(c).findingsPartial).toBe(true);
    expect(c.totals.resolvedFindings).toBe(0);
  });

  it('a component added to the catalog: its open alerts are not new; findingsPartial true', () => {
    const c = changesFor(
      previousOf(alphaNow(), {
        findings: [],
        repositories: alphaRepos.filter((r) => r !== dependabot7.repository),
      }),
    );
    expect(alphaOf(c).newFindings).toEqual([]);
    expect(alphaOf(c).findingsPartial).toBe(true);
    expect(c.totals.newFindings).toBe(0);
  });

  it('an alert still open at a lower severity is not resolved', () => {
    const c = changesFor(previousOf(alphaNow(), { findings: [dependabot7] }), ({ project }) => {
      project.securityFindings.find((f) => f.id === dependabot7.id)!.severity = 'medium';
    });
    expect(alphaOf(c).resolvedFindings).toEqual([]);
    expect(c.totals.resolvedFindings).toBe(0);
  });

  it('a baseline cut at 500 alerts: the next run lists no new alerts and flags findingsPartial', () => {
    const r = runOf('project-alpha');
    r.index.generatedAt = daysAgo(1);
    const template = r.project.securityFindings.find((f) => f.id === dependabot7.id)!;
    for (let n = 1000; n < 1520; n++)
      r.project.securityFindings.push({
        ...template,
        id: `example-org/project-alpha-frontend#dependabot#${n}`,
      });
    const history = appendHistory(
      { state: 'none', file: null },
      r.index,
      [r.project],
      catalog,
      policies,
      NOW,
    );
    expect(history.baseline.projects[0]!.findings).toHaveLength(500);
    const next = structuredClone(r);
    next.index.generatedAt = NOW.toISOString();
    const c = computeChanges({ state: 'restored', file: history }, next.index, [next.project]);
    expect(alphaOf(c).newFindings).toEqual([]);
    expect(alphaOf(c).findingsPartial).toBe(true);
    expect(c.totals.newFindings).toBe(0);
  });

  it('an unreadable list at its cap: no new alerts; findingsPartial true', () => {
    const unreadable = Array.from({ length: 500 }, (_, n) => `example-org/r${n}|dependabot`);
    const c = changesFor(previousOf(alphaNow(), { findings: [], unreadable }));
    expect(alphaOf(c).newFindings).toEqual([]);
    expect(alphaOf(c).findingsPartial).toBe(true);
  });

  it('an error list at its cap: no new errors listed', () => {
    const errors = Array.from({ length: 500 }, (_, n) => `example-org/r${n}|dependabot|not-found`);
    const c = changesFor(previousOf(alphaNow(), { errors }), ({ project }) => {
      project.collectionErrors.push({
        repository: 'example-org/project-alpha-web',
        source: 'secret-scanning',
        classification: 'not-authorised',
      });
    });
    expect(alphaOf(c).newErrors).toEqual([]);
    expect(c.totals.newErrors).toBe(0);
  });

  it('61 new findings → 50 listed, findingsTruncated 11, totals.newFindings 61', () => {
    const c = changesFor(previousOf(alphaNow(), { findings: [dependabot7] }), ({ project }) => {
      const template = project.securityFindings.find((f) => f.id === dependabot7.id)!;
      for (let n = 100; n < 161; n++)
        project.securityFindings.push({
          ...template,
          id: `example-org/project-alpha-frontend#dependabot#${n}`,
        });
    });
    expect(alphaOf(c).newFindings).toHaveLength(50);
    expect(alphaOf(c).findingsTruncated).toBe(11);
    expect(c.totals.newFindings).toBe(61);
  });

  it('version 3.0.2 → 3.1.0 is a move; null → 3.1.0 and 3.1.0 → null are not', () => {
    const move = changesFor(
      previousOf(alphaNow(), {
        versions: versionsNow.map((v) =>
          v.componentId === 'frontend' ? { ...v, version: '2.0.3' } : v,
        ),
      }),
    );
    expect(alphaOf(move).versionMoves).toEqual([
      { kind: 'component', componentId: 'frontend', from: '2.0.3', to: '2.1.0' },
    ]);
    expect(move.totals.versionMoves).toBe(1);

    const unknownBefore = changesFor(
      previousOf(alphaNow(), {
        versions: versionsNow.map((v) =>
          v.componentId === 'frontend' ? { ...v, version: null } : v,
        ),
      }),
    );
    expect(alphaOf(unknownBefore).versionMoves).toEqual([]);

    const unknownNow = changesFor(
      previousOf(alphaNow(), { versions: versionsNow }),
      ({ project }) => {
        project.components.find((c) => c.id === 'frontend')!.effectiveVersion = null;
      },
    );
    expect(alphaOf(unknownNow).versionMoves).toEqual([]);
  });

  describe('repository check changes', () => {
    const BACKEND = 'example-org/project-alpha-backend';
    const setCheck = (
      r: ReturnType<typeof runOf>,
      repo: string,
      check: string,
      state: 'pass' | 'fail' | 'unknown' | 'not-applicable',
    ) => {
      r.project.repositoryControls.repositories
        .find((x) => x.repository === repo)!
        .checks.find((c) => c.id === check)!.state = state;
    };

    it('pass → fail and fail → pass are listed; unknown → fail is not', () => {
      const c = changesFor(
        previousOf(alphaNow(), {
          checks: [`${BACKEND}|branch-protected|pass`, `${BACKEND}|pull-request-required|fail`],
        }),
        (r) => {
          setCheck(r, BACKEND, 'branch-protected', 'fail');
          setCheck(r, BACKEND, 'pull-request-required', 'pass');
          // Not in the baseline (unknown then): never a change.
          setCheck(r, BACKEND, 'force-push-blocked', 'fail');
        },
      );
      expect(alphaOf(c).checkChanges).toEqual([
        { repository: BACKEND, check: 'branch-protected', from: 'pass', to: 'fail' },
        { repository: BACKEND, check: 'pull-request-required', from: 'fail', to: 'pass' },
      ]);
      expect(c.totals.checkChanges).toBe(2);
    });

    it('pass → unknown and pass → not-applicable are not changes', () => {
      const c = changesFor(
        previousOf(alphaNow(), {
          checks: [`${BACKEND}|branch-protected|pass`, `${BACKEND}|pull-request-required|pass`],
        }),
        (r) => {
          setCheck(r, BACKEND, 'branch-protected', 'unknown');
          setCheck(r, BACKEND, 'pull-request-required', 'not-applicable');
        },
      );
      expect(alphaOf(c).checkChanges).toEqual([]);
      expect(c.totals.checkChanges).toBe(0);
    });

    it('a baseline without checks is not compared', () => {
      const c = changesFor(previousOf(alphaNow()), (r) =>
        setCheck(r, BACKEND, 'branch-protected', 'fail'),
      );
      expect(alphaOf(c).checkChanges).toEqual([]);
      expect(c.totals.checkChanges).toBe(0);
    });

    it('the baseline records only pass and fail states', () => {
      const r = runOf('project-beta');
      const b = buildBaseline(r.index, [r.project]).projects[0]!;
      expect(b.checks).toContain('example-org/project-beta-web|branch-protected|fail');
      expect(b.checks).toContain('example-org/project-beta-coordinator|branch-protected|pass');
      expect(b.checks!.every((k) => /\|(pass|fail)$/.test(k))).toBe(true);
      expect(b.checks!.some((k) => k.startsWith('example-org/project-beta-helm|'))).toBe(false);
    });

    it('the history point carries the controls counts', () => {
      const r = runOf('project-beta');
      expect(entryFromRun(r.index).projects[0]!.controls).toEqual({
        passed: 5,
        failed: 7,
        unknown: 8,
      });
    });

    it('no controls are recorded when nothing was evaluated (checks off), never 0/0/0', () => {
      const r = runOf('project-beta');
      Object.assign(r.index.projects[0]!.repositoryControls, { passed: 0, failed: 0, unknown: 0 });
      expect(entryFromRun(r.index).projects[0]!.controls).toBeUndefined();
    });

    it('a 1.0 history file is read (no controls) and checkChanges is [] with no error', async () => {
      const previous = await loadGithub(githubHistory());
      expect(previous.state).toBe('restored');
      const c = changesFor(previous);
      expect(alphaOf(c).checkChanges).toEqual([]);
      expect(c.totals.checkChanges).toBe(0);
      expect(c.basis.state).toBe('compared');
    });
  });

  it('new error key listed; previous-only key counted in resolvedErrors', () => {
    const c = changesFor(
      previousOf(alphaNow(), { errors: ['example-org/gone|dependabot|not-found'] }),
      ({ project }) => {
        project.collectionErrors.push({
          repository: 'example-org/project-alpha-web',
          source: 'secret-scanning',
          classification: 'not-authorised',
        });
      },
    );
    expect(alphaOf(c).newErrors).toEqual([
      {
        repository: 'example-org/project-alpha-web',
        source: 'secret-scanning',
        classification: 'not-authorised',
      },
    ]);
    expect(alphaOf(c).resolvedErrors).toBe(1);
    expect(c.totals.newErrors).toBe(1);
  });

  it('project absent in the previous entry → added true, nothing compared', () => {
    const c = changesFor(previousOf(historyPoint({ id: 'platform' })));
    expect(alphaOf(c)).toMatchObject({
      added: true,
      previous: null,
      statusChanges: [],
      newFindings: [],
      versionMoves: [],
      newErrors: [],
      checkChanges: [],
    });
    expect(c.totals).toEqual({
      statusChanges: 0,
      newFindings: 0,
      resolvedFindings: 0,
      versionMoves: 0,
      newErrors: 0,
      checkChanges: 0,
    });
  });

  it.each(['none', 'restore-failed', 'unreadable', 'incompatible', 'source-changed'] as const)(
    'fresh state %s → basis.state equals it, previousCollectedAt null, totals all 0',
    (state) => {
      const c = changesFor({ state, file: null });
      expect(c.basis).toEqual({ state, previousCollectedAt: null, synthetic: false });
      expect(c.totals).toEqual({
        statusChanges: 0,
        newFindings: 0,
        resolvedFindings: 0,
        versionMoves: 0,
        newErrors: 0,
        checkChanges: 0,
      });
      expect(alphaOf(c)).toMatchObject({ added: false, previous: null, newFindings: [] });
    },
  );

  it('fixture state → basis.state compared, synthetic true', () => {
    const c = changesFor(previousOf(alphaNow(), {}, 'fixture'));
    expect(c.basis).toEqual({
      state: 'compared',
      previousCollectedAt: daysAgo(1),
      synthetic: true,
    });
  });

  it('a baseline dropped by cleaning compares statuses only and flags findingsPartial', () => {
    const prev = alphaNow();
    prev.dimensions.delivery = 'amber';
    const file = cleanHistory(
      historyFile([
        historyEntry(daysAgo(2), { projects: [prev] }),
        historyEntry(NOW.toISOString()),
      ]),
      catalog,
      policies,
      NOW,
    );
    expect(file.baseline).toBeNull();
    const c = changesFor({ state: 'restored', file });
    expect(alphaOf(c).statusChanges).toEqual([
      { dimension: 'delivery', from: 'amber', to: 'green' },
    ]);
    expect(alphaOf(c)).toMatchObject({ findingsPartial: true, newFindings: [], versionMoves: [] });
  });
});
