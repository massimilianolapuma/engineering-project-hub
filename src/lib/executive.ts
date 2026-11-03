import type {
  ChangesFile,
  Dimension,
  HealthStatus,
  HistoryFile,
  Policies,
  PortfolioIndex,
} from '@model/index';
import { teamMatch } from './portfolio-filters-core';

/*
 * Executive summary model (spec §5.6). Pure and free of Astro, DOM and Node imports (type-only
 * model imports), because the team filter re-runs it in the browser. The input keeps only what
 * the page may print: no repository, component, alert, exception, image or license data. Team
 * slugs are kept for the filter and never reach the view.
 */

const DAY_MS = 86_400_000;
const STATUSES = ['red', 'amber', 'green', 'grey'] as const satisfies readonly HealthStatus[];
/** Lower = worse (same order as healthRank in format.ts). */
const RANK: Record<HealthStatus, number> = { red: 0, amber: 1, grey: 2, green: 3 };

export interface ExecProject {
  id: string;
  name: string;
  teamSlugs: string[];
  overall: HealthStatus;
  dims: Record<Dimension, HealthStatus>;
  score: number | null;
  open: { critical: number | null; high: number | null };
  countsComplete: boolean;
  secrets: number | null;
  overdue: number | null;
  overdueCriticalHigh: number | null;
  accepted: number | null;
  exceptionIssues: number;
  supplyChain: {
    repositories: number | null;
    sbomAvailable: number | null;
    unsignedImages: number | null;
    flagged: number | null;
  };
  collectionErrors: number;
  /** Overall status since the last collection; null when not compared or grey on either side. */
  direction: 'worse' | 'better' | null;
  /** Overall status in the comparison and start columns; null = not in that history entry. */
  past: { compare: HealthStatus | null; start: HealthStatus | null };
}

export interface ExecInput {
  generatedAt: string;
  dataSource: string;
  projects: ExecProject[];
  trend: {
    state: 'ok' | 'none' | 'off';
    now: string | null;
    compare: string | null;
    start: string | null;
    trendDays: number;
  };
  topRisks: number;
}

/** null = not measured; lower = some values were unknown, so the sum is "≥ n". */
export type Bound = { n: number; lower: boolean } | null;

export const RISK_KINDS = [
  'not-measurable',
  'critical-open',
  'overdue',
  'high-open',
  'secrets',
  'delivery-failing',
  'controls-missing',
  'versions-out-of-line',
  'quality-low',
  'unsigned-images',
  'partly-visible',
] as const;
export type RiskKind = (typeof RISK_KINDS)[number];

type Cells = { now: number; compare: number | null; start: number | null };
export interface ExecView {
  total: number;
  tiles: Record<HealthStatus, number>;
  trend: ExecInput['trend'] & { rows: Record<HealthStatus | 'projects', Cells> };
  risks: {
    id: string;
    name: string;
    overall: HealthStatus;
    direction: 'worse' | 'better' | null;
    kinds: RiskKind[];
    counts: Partial<Record<RiskKind, Bound>>;
  }[];
  /** Every red, grey or amber project, in risk order (the page pre-renders them all). */
  riskCandidates: string[];
  remediation: {
    overdue: Bound;
    overdueCriticalHigh: Bound;
    projectsWithOverdue: number;
    accepted: Bound;
    exceptionIssues: number;
  };
  supplyChain: { sbom: Bound; repositories: Bound; unsigned: Bound; flagged: Bound };
}

function direction(
  prev: HealthStatus | null | undefined,
  cur: HealthStatus,
): ExecProject['direction'] {
  if (!prev || prev === 'grey' || cur === 'grey' || prev === cur) return null;
  return RANK[cur] < RANK[prev] ? 'worse' : 'better';
}

export function toExecInput(
  index: PortfolioIndex,
  history: HistoryFile | null,
  historyEnabled: boolean,
  changes: ChangesFile | null,
  outputs: Policies['outputs']['executive'],
  now: Date,
): ExecInput {
  const entries = historyEnabled && history ? [...history.entries] : [];
  entries.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  const cutoff = now.getTime() - outputs.trendDays * DAY_MS;
  const compare = entries.filter((e) => Date.parse(e.collectedAt) <= cutoff).at(-1) ?? null;
  const start = entries[0] ?? null;
  const statusIn = (entry: typeof start, id: string) =>
    entry?.projects.find((p) => p.id === id)?.overall ?? null;
  const compared = changes?.basis.state === 'compared';
  const changed = new Map((changes?.projects ?? []).map((c) => [c.id, c]));

  const projects = index.projects.map((p): ExecProject => {
    const c = compared ? changed.get(p.id) : undefined;
    return {
      id: p.id,
      name: p.name,
      teamSlugs: p.teams.map((t) => t.slice(t.indexOf('/') + 1).toLowerCase()),
      overall: p.overall,
      dims: {
        delivery: p.delivery,
        version: p.version,
        security: p.security,
        coverage: p.coverage.status,
        governance: p.governance,
        quality: p.quality.status,
      },
      score: p.score.value,
      open: { critical: p.openCounts.critical, high: p.openCounts.high },
      countsComplete: p.countsComplete,
      secrets: p.openSecretAlerts,
      overdue: p.risk.overdue,
      overdueCriticalHigh: p.risk.overdueCriticalHigh,
      accepted: p.risk.accepted,
      exceptionIssues: p.risk.exceptionIssues,
      supplyChain: { ...p.supplyChain },
      collectionErrors: p.collectionErrorCount,
      direction: c ? direction(c.previous?.overall, c.current.overall) : null,
      past: { compare: statusIn(compare, p.id), start: statusIn(start, p.id) },
    };
  });

  return {
    generatedAt: index.generatedAt,
    dataSource: index.run.dataSource,
    projects,
    trend: {
      state: !historyEnabled ? 'off' : entries.length === 0 ? 'none' : 'ok',
      now: index.generatedAt,
      compare: compare?.collectedAt ?? null,
      start: start?.collectedAt ?? null,
      trendDays: outputs.trendDays,
    },
    topRisks: outputs.topRisks,
  };
}

/** Projects with at least one of the given team slugs; no slug = unchanged. */
export function filterInput(input: ExecInput, teams: string[]): ExecInput {
  if (teams.length === 0) return input;
  return { ...input, projects: input.projects.filter((p) => teamMatch(teams, p.teamSlugs)) };
}

/** Sum of the known values; null when none is known. */
function sum(values: (number | null)[]): Bound {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return null;
  return { n: known.reduce((a, b) => a + b, 0), lower: known.length < values.length };
}

const positive = (v: number | null): v is number => v !== null && v > 0;

function riskKinds(p: ExecProject): {
  kinds: RiskKind[];
  counts: Partial<Record<RiskKind, Bound>>;
} {
  const counts: Partial<Record<RiskKind, Bound>> = {};
  const checks: [RiskKind, boolean, Bound?][] = [
    ['not-measurable', p.overall === 'grey'],
    [
      'critical-open',
      positive(p.open.critical),
      { n: p.open.critical ?? 0, lower: !p.countsComplete },
    ],
    ['overdue', positive(p.overdueCriticalHigh), { n: p.overdueCriticalHigh ?? 0, lower: false }],
    ['high-open', positive(p.open.high), { n: p.open.high ?? 0, lower: !p.countsComplete }],
    ['secrets', positive(p.secrets), { n: p.secrets ?? 0, lower: false }],
    ['delivery-failing', p.dims.delivery === 'red'],
    ['controls-missing', p.dims.coverage === 'red'],
    ['versions-out-of-line', p.dims.version === 'red'],
    ['quality-low', p.dims.quality === 'red'],
    [
      'unsigned-images',
      positive(p.supplyChain.unsignedImages),
      { n: p.supplyChain.unsignedImages ?? 0, lower: false },
    ],
    [
      'partly-visible',
      p.overall !== 'grey' && (p.collectionErrors > 0 || !p.countsComplete),
      { n: p.collectionErrors, lower: false },
    ],
  ];
  const kinds: RiskKind[] = [];
  for (const [kind, hit, count] of checks) {
    if (!hit || kinds.length === 3) continue;
    kinds.push(kind);
    if (count) counts[kind] = count;
  }
  return { kinds, counts };
}

/** red, grey, amber; then more open critical, more open high, lower score, id. */
const GROUP: Partial<Record<HealthStatus, number>> = { red: 0, grey: 1, amber: 2 };
function riskOrder(a: ExecProject, b: ExecProject): number {
  return (
    GROUP[a.overall]! - GROUP[b.overall]! ||
    (b.open.critical ?? -1) - (a.open.critical ?? -1) ||
    (b.open.high ?? -1) - (a.open.high ?? -1) ||
    (a.score ?? Infinity) - (b.score ?? Infinity) ||
    a.id.localeCompare(b.id)
  );
}

export function buildExecutiveView(input: ExecInput): ExecView {
  const ps = input.projects;
  const count = (col: 'compare' | 'start', s: HealthStatus) =>
    input.trend[col] === null ? null : ps.filter((p) => p.past[col] === s).length;
  const rows = Object.fromEntries([
    ...STATUSES.map((s) => [
      s,
      {
        now: ps.filter((p) => p.overall === s).length,
        compare: count('compare', s),
        start: count('start', s),
      },
    ]),
    [
      'projects',
      {
        now: ps.length,
        compare: input.trend.compare === null ? null : ps.filter((p) => p.past.compare).length,
        start: input.trend.start === null ? null : ps.filter((p) => p.past.start).length,
      },
    ],
  ]) as Record<HealthStatus | 'projects', Cells>;
  const candidates = ps.filter((p) => p.overall in GROUP).sort(riskOrder);

  return {
    total: ps.length,
    tiles: Object.fromEntries(STATUSES.map((s) => [s, rows[s].now])) as Record<
      HealthStatus,
      number
    >,
    trend: { ...input.trend, rows },
    risks: candidates.slice(0, input.topRisks).map((p) => ({
      id: p.id,
      name: p.name,
      overall: p.overall,
      direction: p.direction,
      ...riskKinds(p),
    })),
    riskCandidates: candidates.map((p) => p.id),
    remediation: {
      overdue: sum(ps.map((p) => p.overdue)),
      overdueCriticalHigh: sum(ps.map((p) => p.overdueCriticalHigh)),
      projectsWithOverdue: ps.filter((p) => positive(p.overdue)).length,
      accepted: sum(ps.map((p) => p.accepted)),
      exceptionIssues: ps.reduce((n, p) => n + p.exceptionIssues, 0),
    },
    supplyChain: {
      sbom: sum(ps.map((p) => p.supplyChain.sbomAvailable)),
      repositories: sum(ps.map((p) => p.supplyChain.repositories)),
      unsigned: sum(ps.map((p) => p.supplyChain.unsignedImages)),
      flagged: sum(ps.map((p) => p.supplyChain.flagged)),
    },
  };
}

export { STATUSES as EXEC_STATUSES };
