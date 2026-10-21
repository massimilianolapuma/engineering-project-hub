import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HistoryFileSchema, type HistoryFile } from '@model/index';
import { useI18n } from '../../src/i18n';
import {
  STRIP_HEIGHT,
  seriesFor,
  sparklineSegments,
  summarise,
  trendText,
  type TrendSummary,
} from '../../src/lib/trend';

const golden: HistoryFile = HistoryFileSchema.parse(
  JSON.parse(readFileSync('fixtures/snapshots/history.json', 'utf8')),
);
const summary = (id: string) => summarise(seriesFor(golden, id, 30));

describe('sparklineSegments', () => {
  it('splits at gaps and keeps a single point as a dot', () => {
    expect(sparklineSegments([10, null, 30, 20], 90, 20)).toEqual(['M0 18h0', 'M60 14L90 16']);
  });
  it('draws nothing when no point is measured', () => {
    expect(sparklineSegments([null, null], 90, 20)).toEqual([]);
    expect(sparklineSegments([], 90, 20)).toEqual([]);
  });
  it('centres a single point', () => {
    expect(sparklineSegments([50], 96, 20)).toEqual(['M48 10h0']);
  });
  it('uses a fixed 0-100 scale', () => {
    expect(sparklineSegments([0, 100], 10, 10)).toEqual(['M0 10L10 0']);
  });
  it('never turns null into 0', () => {
    expect(sparklineSegments([null, 40, null], 20, 10)).toEqual(['M10 6h0']);
  });
});

describe('seriesFor and summarise on the golden history', () => {
  it('returns every point of the project, with a null score kept as a gap', () => {
    const s = seriesFor(golden, 'project-alpha', 30);
    expect(s).toHaveLength(13);
    expect(s[6]!.score).toBeNull();
    expect(s[6]!.at).toBe('2026-01-09T12:00:00.000Z');
  });
  it('keeps the last max points', () => {
    const s = seriesFor(golden, 'project-alpha', 5);
    expect(s).toHaveLength(5);
    expect(s.at(-1)!.score).toBe(78);
  });
  it('does not invent points for a project that appeared later', () => {
    expect(seriesFor(golden, 'platform', 30)).toHaveLength(10);
    expect(seriesFor(golden, 'nope', 30)).toEqual([]);
  });
  it('summarises first, last, delta, days and count', () => {
    expect(summary('project-alpha')).toMatchObject({
      first: 64,
      last: 78,
      delta: 14,
      days: 12,
      count: 13,
    });
    expect(summary('project-beta')).toMatchObject({
      first: 62,
      last: 40,
      delta: -22,
      days: 12,
      count: 13,
    });
    expect(summary('platform')).toMatchObject({
      first: 84,
      last: 82,
      delta: -2,
      days: 9,
      count: 10,
    });
  });
  it('returns null with fewer than two measured points', () => {
    expect(summary('project-gamma')).toBeNull();
  });
});

describe('STRIP_HEIGHT', () => {
  it('encodes status by height: worse is taller, unknown full height', () => {
    expect(STRIP_HEIGHT.red).toBeGreaterThan(STRIP_HEIGHT.amber);
    expect(STRIP_HEIGHT.amber).toBeGreaterThan(STRIP_HEIGHT.green);
    expect(STRIP_HEIGHT.grey).toBe(1);
    expect(STRIP_HEIGHT.red).toBe(1);
  });
});

describe('trendText plurals and short spans', () => {
  const base: TrendSummary = { first: 70, last: 71, delta: 1, days: 0, hours: 6, count: 2 };
  const en = useI18n('en');
  const itl = useI18n('it');
  it('uses the singular for one point and hours below one day (EN)', () => {
    const t = trendText(en, base);
    expect(t.label).toBe('Score up 1 point over 6 hours (2 collections)');
    expect(t.short).toBe('+1 · 6 h');
  });
  it('uses the plural for several points and days (EN)', () => {
    const t = trendText(en, { ...base, delta: -3, days: 2, hours: 48 });
    expect(t.label).toBe('Score down 3 points over 2 days (2 collections)');
    expect(t.short).toBe('\u22123 · 2 d');
  });
  it('reads one day and one hour in the singular', () => {
    expect(trendText(en, { ...base, days: 1, hours: 24 }).label).toContain('over 1 day (');
    expect(trendText(en, { ...base, hours: 1 }).label).toContain('over 1 hour (');
  });
  it('reads naturally in Italian', () => {
    expect(trendText(itl, base).label).toBe(
      'Punteggio in aumento di 1 punto in 6 ore (2 raccolte)',
    );
    expect(trendText(itl, { ...base, delta: -2, days: 3, hours: 72 }).label).toBe(
      'Punteggio in calo di 2 punti in 3 giorni (2 raccolte)',
    );
    expect(trendText(itl, { ...base, delta: 0, days: 1, hours: 24 }).label).toBe(
      'Punteggio invariato in 1 giorno (2 raccolte)',
    );
  });
});
