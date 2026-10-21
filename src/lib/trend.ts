import type { Dimension, HealthStatus, HistoryFile } from '@model/index';
import type { I18n } from '../i18n';

/*
 * Pure helpers for the trend views. A null score is a gap: it is never drawn as 0 and never
 * interpolated across. The sparkline uses a fixed 0-100 scale so two projects compare.
 */
const DAY_MS = 86_400_000;

export interface TrendPoint {
  at: string;
  score: number | null;
  overall: HealthStatus;
  /** A missing key means the dimension was not tracked at that time. */
  dimensions: Partial<Record<Dimension, HealthStatus>>;
  open: { critical: number | null; high: number | null };
}

/** The last `max` points of one project, oldest first. A project absent from an entry has no point. */
export function seriesFor(history: HistoryFile, projectId: string, max: number): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (const entry of history.entries) {
    const p = entry.projects.find((x) => x.id === projectId);
    if (p)
      points.push({
        at: entry.collectedAt,
        score: p.score,
        overall: p.overall,
        dimensions: p.dimensions,
        open: { critical: p.open.critical, high: p.open.high },
      });
  }
  return points.slice(-max);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** SVG path segments (one per run of measured scores); a lone point is a zero-length line. */
export function sparklineSegments(scores: (number | null)[], w: number, h: number): string[] {
  const n = scores.length;
  const runs: string[][] = [];
  let open = false;
  scores.forEach((score, i) => {
    if (score === null) {
      open = false;
      return;
    }
    const x = round1(n === 1 ? w / 2 : (i * w) / (n - 1));
    const y = round1(h - (score / 100) * h);
    if (!open) runs.push([]);
    runs.at(-1)!.push(`${x} ${y}`);
    open = true;
  });
  return runs.map((r) => (r.length === 1 ? `M${r[0]}h0` : `M${r.join('L')}`));
}

export interface TrendSummary {
  first: number;
  last: number;
  delta: number;
  days: number;
  count: number;
}

/** First and last measured score of the window; null when fewer than two points were measured. */
export function summarise(points: TrendPoint[]): TrendSummary | null {
  const measured = points.filter((p) => p.score !== null);
  if (measured.length < 2) return null;
  const first = measured[0]!;
  const last = measured.at(-1)!;
  return {
    first: first.score!,
    last: last.score!,
    delta: last.score! - first.score!,
    days: Math.round((Date.parse(last.at) - Date.parse(first.at)) / DAY_MS),
    count: points.length,
  };
}

/** Strip cell height as a share of the strip: height repeats the status (not colour alone). */
export const STRIP_HEIGHT: Record<HealthStatus, number> = {
  red: 1,
  amber: 0.667,
  green: 0.333,
  grey: 1,
};

export interface TrendText {
  /** Full sentence, the accessible name of the sparkline. */
  label: string;
  /** Compact visible delta, e.g. "+14 · 12 d". */
  short: string;
  /** Direction glyph; the number next to it carries the meaning. */
  arrow: '▲' | '▼' | '=';
}

/** Text for a summary: the sentence and the short delta, in the page language. */
export function trendText(i18n: I18n, s: TrendSummary): TrendText {
  const { d, f } = i18n;
  const n = Math.abs(s.delta);
  const params = { n, days: s.days, count: s.count };
  const label = s.delta > 0 ? d.trend.up : s.delta < 0 ? d.trend.down : d.trend.flat;
  const sign = s.delta > 0 ? '+' : s.delta < 0 ? '\u2212' : '±';
  return {
    label: f(label, params),
    short: f(d.trend.short, { sign, n, days: s.days }),
    arrow: s.delta > 0 ? '▲' : s.delta < 0 ? '▼' : '=',
  };
}
