import type { HealthStatus } from '@model/index';
import type { Dict } from '../i18n/en';
import type { Bound, ExecView, RiskKind } from './executive';

/*
 * Sentences of the executive summary, from fixed templates only (spec §5.6). Pure: the server
 * render and the browser team filter share it, so both print the same words.
 */

export type ExecStrings = Dict['executive'];

export interface ExecText {
  lede: string;
  trendSentence: string;
  trendCaption: string;
  risks: { id: string; sentences: string[] }[];
  remediation: string;
  exceptions: string;
  supplyChain: string;
  filtered: (n: number, m: number) => string;
}

const fill = (template: string, params: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? '—'));
const pick = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** "≥ 3" for a lower bound, "3" otherwise. */
export const boundText = (b: { n: number; lower: boolean }) => (b.lower ? `≥ ${b.n}` : String(b.n));

/** Calendar day in UTC ("3 Jan 2026", "3 gen 2026"); the same on the server and in the browser. */
export function execDateFormatter(locale: 'en' | 'it'): (iso: string) => string {
  const f = new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
  return (iso) => f.format(new Date(iso));
}

const RISK_KEY: Record<RiskKind, keyof ExecStrings['risk']> = {
  'not-measurable': 'notMeasurable',
  'critical-open': 'criticalOpen',
  overdue: 'overdue',
  'high-open': 'highOpen',
  secrets: 'secrets',
  'delivery-failing': 'deliveryFailing',
  'controls-missing': 'controlsMissing',
  'versions-out-of-line': 'versionsOutOfLine',
  'quality-low': 'qualityLow',
  'unsigned-images': 'unsignedImages',
  'partly-visible': 'partlyVisible',
};

function riskSentence(s: ExecStrings, kind: RiskKind, count: Bound | undefined): string {
  const key = RISK_KEY[kind];
  if (!count) return s.risk[key];
  const oneKey = `${key}One` as keyof ExecStrings['risk'];
  const template = count.n === 1 && oneKey in s.risk ? s.risk[oneKey] : s.risk[key];
  return fill(template, { n: boundText(count) });
}

function trendSentence(view: ExecView, s: ExecStrings, date: (iso: string) => string): string {
  const t = view.trend;
  if (t.state === 'off') return s.trend.off;
  if (t.state === 'none' || t.start === null) return s.trend.none;
  const order: HealthStatus[] = ['red', 'grey', 'amber', 'green'];
  const moved = order.find((st) => t.rows[st].start !== t.rows[st].now) ?? null;
  if (moved === null) return fill(s.trend.noChange, { date: date(t.start) });
  return fill(s.trend.sentence, {
    label: s.trend.label[moved],
    from: t.rows[moved].start!,
    to: t.rows[moved].now,
    date: date(t.start),
  });
}

function supplyChainLine(view: ExecView, s: ExecStrings): string {
  const sc = view.supplyChain;
  const c = s.supplyChain;
  const sbom =
    sc.sbom && sc.repositories
      ? fill(c.sbom, {
          s: boundText(sc.sbom),
          r: fill(pick(sc.repositories.n, c.reposOne, c.reposMany), {
            n: boundText(sc.repositories),
          }),
        })
      : c.sbomNotMeasured;
  const unsigned = sc.unsigned
    ? fill(pick(sc.unsigned.n, c.unsignedOne, c.unsignedMany), { n: boundText(sc.unsigned) })
    : c.unsignedNotMeasured;
  const flagged = sc.flagged
    ? fill(pick(sc.flagged.n, c.flaggedOne, c.flaggedMany), { n: boundText(sc.flagged) })
    : c.flaggedNotMeasured;
  return [sbom, unsigned, flagged].join(' · ');
}

export function executiveText(
  view: ExecView,
  s: ExecStrings,
  date: (iso: string) => string,
): ExecText {
  const r = view.remediation;
  const notMeasured = s.overdue.value;
  const remediation =
    r.overdue === null
      ? s.overdue.notMeasured
      : fill(s.overdue.line, {
          n: boundText(r.overdue),
          m: r.overdueCriticalHigh ? boundText(r.overdueCriticalHigh) : notMeasured,
          k: fill(pick(r.projectsWithOverdue, s.overdue.inOne, s.overdue.inMany), {
            n: r.projectsWithOverdue,
          }),
        });
  return {
    lede: fill(pick(view.total, s.ledeOne, s.lede), {
      n: view.total,
      date: date(view.trend.now ?? ''),
    }),
    trendSentence: trendSentence(view, s, date),
    trendCaption: fill(pick(view.trend.trendDays, s.trend.captionOne, s.trend.caption), {
      n: view.trend.trendDays,
    }),
    risks: view.risks.map((risk) => ({
      id: risk.id,
      sentences: risk.kinds.map((k) => riskSentence(s, k, risk.counts[k])),
    })),
    remediation,
    exceptions: fill(s.overdue.exceptions, {
      a: r.accepted ? boundText(r.accepted) : notMeasured,
      e: r.exceptionIssues,
    }),
    supplyChain: supplyChainLine(view, s),
    filtered: (n, m) => fill(pick(m, s.filteredOne, s.filtered), { n, m }),
  };
}
