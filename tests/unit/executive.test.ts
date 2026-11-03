import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ChangesFileSchema,
  HistoryFileSchema,
  PortfolioIndexSchema,
  type HistoryFile,
  type PortfolioIndex,
} from '@model/index';
import { en } from '../../src/i18n/en';
import { it as itDict } from '../../src/i18n/it';
import {
  buildExecutiveView,
  filterInput,
  toExecInput,
  type ExecInput,
} from '../../src/lib/executive';
import { execDateFormatter, executiveText } from '../../src/lib/executive-text';

/*
 * Executive summary (spec §5.6): a redacted, printable view built from index.json,
 * history.json and changes.json. Unknown counts are never 0: they are "not measured" or "≥ n".
 */
const read = (f: string) => JSON.parse(readFileSync(`fixtures/snapshots/${f}`, 'utf8')) as unknown;
const index = (): PortfolioIndex => PortfolioIndexSchema.parse(read('index.json'));
const history = (): HistoryFile => HistoryFileSchema.parse(read('history.json'));
const changes = () => ChangesFileSchema.parse(read('changes.json'));
const NOW = new Date('2026-01-15T12:00:00.000Z');
const OUT = { enabled: true, topRisks: 5, trendDays: 7 };
const input = (o: Partial<typeof OUT> = {}): ExecInput =>
  toExecInput(index(), history(), true, changes(), { ...OUT, ...o }, NOW);
const fmt = execDateFormatter('en');
const textOf = (i: ExecInput) => executiveText(buildExecutiveView(i), en.executive, fmt);

describe('executive view on the golden data', () => {
  const view = buildExecutiveView(input());

  it('counts the portfolio tiles', () => {
    expect(view.tiles).toEqual({ red: 2, amber: 1, green: 0, grey: 1 });
    expect(view.total).toBe(4);
  });

  it('picks the trend columns: now, trendDays ago, start of history', () => {
    expect(view.trend.state).toBe('ok');
    expect(view.trend.now).toBe('2026-01-15T12:00:00.000Z');
    expect(view.trend.compare).toBe('2026-01-08T12:00:00.000Z');
    expect(view.trend.start).toBe('2026-01-03T12:00:00.000Z');
    expect(view.trend.rows.red).toEqual({ now: 2, compare: 0, start: 0 });
    expect(view.trend.rows.amber).toEqual({ now: 1, compare: 3, start: 2 });
    expect(view.trend.rows.projects).toEqual({ now: 4, compare: 4, start: 3 });
    expect(textOf(input()).trendSentence).toBe('Critical projects: 0 → 2 since 3 Jan 2026.');
  });

  it('orders top risks red, grey, amber, then by critical, high, score', () => {
    expect(view.risks.map((r) => r.id)).toEqual([
      'project-beta',
      'platform',
      'project-gamma',
      'project-alpha',
    ]);
    const two = buildExecutiveView(input({ topRisks: 2 }));
    expect(two.risks.map((r) => r.id)).toEqual(['project-beta', 'platform']);
    expect(two.riskCandidates).toHaveLength(4);
  });

  it('describes each risk with fixed sentences', () => {
    const [beta, platform, gamma] = view.risks;
    expect(beta!.direction).toBe('worse');
    expect(beta!.kinds[0]).toBe('critical-open');
    expect(textOf(input()).risks[0]!.sentences[0]).toBe('≥ 1 critical security alert open.');
    expect(platform!.kinds.slice(0, 2)).toEqual(['overdue', 'high-open']);
    expect(gamma!.kinds[0]).toBe('not-measurable');
    expect(gamma!.kinds).not.toContain('partly-visible');
    for (const r of view.risks) expect(r.kinds.length).toBeLessThanOrEqual(3);
  });

  it('sums remediation and supply chain, marking lower bounds', () => {
    expect(view.remediation.overdue).toEqual({ n: 1, lower: true });
    expect(view.remediation.overdueCriticalHigh).toEqual({ n: 1, lower: true });
    expect(view.remediation.projectsWithOverdue).toBe(1);
    expect(view.remediation.accepted).toEqual({ n: 3, lower: true });
    expect(view.remediation.exceptionIssues).toBe(3);
    expect(view.supplyChain).toEqual({
      sbom: { n: 4, lower: true },
      repositories: { n: 12, lower: false },
      unsigned: { n: 1, lower: true },
      flagged: { n: 2, lower: true },
    });
  });

  it('never prints repository, team or source-system data', () => {
    const catalog = JSON.stringify(read('catalog.json'));
    const repos = new Set([...catalog.matchAll(/example-org\/[\w.-]+/g)].map((m) => m[0]));
    const blob = JSON.stringify(view) + JSON.stringify(textOf(input()));
    expect(blob).not.toContain('example-org');
    expect(blob).not.toContain('github.com');
    for (const r of repos) expect(blob).not.toContain(r);
    for (const slug of ['pay-project-alpha-dev', 'pay-project-beta-dev'])
      expect(blob).not.toContain(slug);
  });
});

describe('executive view edge cases', () => {
  it('says "not measured" when no project has remediation data', () => {
    const i = input();
    i.projects = i.projects.map((p) => ({ ...p, overdue: null, overdueCriticalHigh: null }));
    const view = buildExecutiveView(i);
    expect(view.remediation.overdue).toBeNull();
    expect(executiveText(view, en.executive, fmt).remediation).toBe(
      'Not measured (remediation deadlines are off or were not collected).',
    );
  });

  it('distinguishes history off, missing and too short', () => {
    expect(toExecInput(index(), history(), false, changes(), OUT, NOW).trend.state).toBe('off');
    expect(toExecInput(index(), null, true, changes(), OUT, NOW).trend.state).toBe('none');
    const long = buildExecutiveView(input({ trendDays: 90 }));
    expect(long.trend.compare).toBeNull();
    expect(long.trend.rows.red.compare).toBeNull();
    expect(long.trend.rows.projects.compare).toBeNull();
  });

  it('never counts a project missing from an old entry in any status', () => {
    const h = history();
    h.entries[0]!.projects = h.entries[0]!.projects.filter((p) => p.id !== 'project-gamma');
    const view = buildExecutiveView(toExecInput(index(), h, true, changes(), OUT, NOW));
    const start = (['red', 'amber', 'green', 'grey'] as const).reduce(
      (n, s) => n + view.trend.rows[s].start!,
      0,
    );
    expect(view.trend.rows.projects.start).toBe(2);
    expect(start).toBe(2);
  });

  it('filters by team without touching the input when no team is given', () => {
    const i = input();
    expect(filterInput(i, [])).toEqual(i);
    const beta = buildExecutiveView(filterInput(i, ['pay-project-beta-dev']));
    expect(beta.total).toBe(1);
    expect(beta.tiles.red).toBe(1);
    const none = buildExecutiveView(filterInput(i, ['nobody']));
    expect(none.total).toBe(0);
    expect(none.risks).toEqual([]);
  });

  it('uses singular wording', () => {
    const i = filterInput(input(), ['pay-project-beta-dev']);
    const t = textOf(i);
    expect(t.lede).toBe('Status of 1 project at 15 Jan 2026.');
    expect(t.supplyChain).toContain('1 unsigned image');
    expect(t.supplyChain).not.toContain('1 unsigned images');
    expect(t.filtered(1, 4)).toBe('Filtered by team: 1 of 4 projects');
  });

  it('formats Italian dates in UTC', () => {
    expect(execDateFormatter('it')('2026-01-03T12:00:00.000Z')).toBe('3 gen 2026');
    expect(
      executiveText(buildExecutiveView(input()), itDict.executive, execDateFormatter('it')).lede,
    ).toContain('15 gen 2026');
  });
});
