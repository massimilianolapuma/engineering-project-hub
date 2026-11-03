import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ChangesFileSchema, HistoryFileSchema, PortfolioIndexSchema } from '@model/index';
import { en } from '../../src/i18n/en';
import { toExecInput } from '../../src/lib/executive';
import { teamFilterPlan } from '../../src/lib/executive-filter';

/*
 * ?team= on the executive page: the browser re-runs the pure model on the team's projects and
 * writes the results as text into the pre-rendered slots. The team value is never printed.
 */
const read = (f: string) => JSON.parse(readFileSync(`fixtures/snapshots/${f}`, 'utf8')) as unknown;
const input = toExecInput(
  PortfolioIndexSchema.parse(read('index.json')),
  HistoryFileSchema.parse(read('history.json')),
  true,
  ChangesFileSchema.parse(read('changes.json')),
  { enabled: true, topRisks: 5, trendDays: 7 },
  new Date('2026-01-15T12:00:00.000Z'),
);

describe('teamFilterPlan', () => {
  it('recomputes the slots for one team', () => {
    const plan = teamFilterPlan(input, en.executive, 'en', ['pay-project-beta-dev'])!;
    expect(plan.slots['tiles.red']).toBe('1');
    expect(plan.slots['tiles.amber']).toBe('0');
    expect(plan.slots['trend.projects.now']).toBe('1');
    expect(plan.slots.lede).toBe('Status of 1 project at 15 Jan 2026.');
    expect(plan.visibleRisks).toEqual(['project-beta']);
    expect(plan.filtered).toBe('Filtered by team: 1 of 4 projects');
    expect(plan.slots.filtered).toBe(plan.filtered);
  });

  it('matches case-insensitively and takes the union of several teams', () => {
    const plan = teamFilterPlan(input, en.executive, 'en', ['PAY-PROJECT-ALPHA-DEV', 'security'])!;
    expect(plan.visibleRisks).toEqual(['platform', 'project-alpha']);
    expect(plan.filtered).toBe('Filtered by team: 2 of 4 projects');
  });

  it('treats a hostile or unknown value as text that matches nothing', () => {
    const plan = teamFilterPlan(input, en.executive, 'en', ['<img src=x>'])!;
    expect(plan.visibleRisks).toEqual([]);
    expect(plan.filtered).toContain('0 of 4');
    for (const v of Object.values(plan.slots)) expect(v).not.toContain('<img');
  });

  it('does nothing without a team', () => {
    expect(teamFilterPlan(input, en.executive, 'en', [])).toBeNull();
    expect(teamFilterPlan(input, en.executive, 'en', ['', '  '])).toBeNull();
  });
});
