import { createHash } from 'node:crypto';
import type { ChangesFile, HealthStatus, NotificationsConfig, PortfolioIndex } from '@model/index';
import { DigestSchema, type Digest, type DigestProject } from './model';

/*
 * Significance (spec §5.5.3, D10): only worsening and new problems are items; improvements never
 * are. Nothing but ids, names, statuses, scores and counts leaves changes.json: alert ids, titles,
 * repositories, URLs and error details are never read into the digest.
 */

/** Worsening order of measured statuses; grey is not on this scale. */
const MEASURED: Record<string, number> = { green: 0, amber: 1, red: 2 };
/** Digest order: worst current overall first. */
const ORDER: Record<HealthStatus, number> = { red: 0, grey: 1, amber: 2, green: 3 };

const worsened = (from: HealthStatus, to: HealthStatus) =>
  from in MEASURED && to in MEASURED && MEASURED[to]! > MEASURED[from]!;
const becameUnknown = (from: HealthStatus, to: HealthStatus) => from in MEASURED && to === 'grey';

type Item = [projectId: string, kind: string, detail: string];

/** First 16 hex characters of SHA-256 over the basis and the sorted significant items (D11). */
export function changeSetKey(previousCollectedAt: string, items: Item[]): string {
  // Code-unit order, never the runtime locale: the key must not change between Node versions.
  const flat = (x: Item) => x.join('\u0000');
  const sorted = [...items].sort((a, b) => (flat(a) < flat(b) ? -1 : flat(a) > flat(b) ? 1 : 0));
  return createHash('sha256')
    .update(JSON.stringify({ previous: previousCollectedAt, items: sorted }), 'utf8')
    .digest('hex')
    .slice(0, 16);
}

export function buildDigest(
  changes: ChangesFile,
  index: PortfolioIndex,
  config: NotificationsConfig,
): Digest | null {
  const basis = changes.basis;
  if (basis.state !== 'compared' || basis.previousCollectedAt === null) return null;
  const t = config.trigger;
  const names = new Map(index.projects.map((p) => [p.id, p.name]));
  const items: Item[] = [];
  const totals = {
    projects: 0,
    overallWorsened: 0,
    becameUnknown: 0,
    newCritical: 0,
    newHigh: 0,
    newlyOverdue: 0,
    newErrors: 0,
    expiredExceptions: 0,
  };
  const projects: DigestProject[] = [];

  for (const p of changes.projects) {
    const own: Item[] = [];
    const project: DigestProject = {
      id: p.id,
      name: names.get(p.id) ?? p.id,
      overall: { from: p.previous?.overall ?? null, to: p.current.overall },
      score: { from: p.previous?.score ?? null, to: p.current.score },
      dimensions: [],
      newFindings: { critical: 0, high: 0 },
      newlyOverdue: { critical: 0, high: 0 },
      newErrors: 0,
      expiredExceptions: 0,
    };

    for (const s of p.statusChanges) {
      if (s.dimension === 'overall') {
        if (t.overallWorsened && worsened(s.from, s.to)) {
          own.push([p.id, 'overall', `${s.from}>${s.to}`]);
          totals.overallWorsened++;
        } else if (t.becameUnknown && becameUnknown(s.from, s.to)) {
          own.push([p.id, 'overall', `${s.from}>${s.to}`]);
          totals.becameUnknown++;
        }
      } else if (t.dimensionsWorsened.includes(s.dimension) && worsened(s.from, s.to)) {
        own.push([p.id, `dimension:${s.dimension}`, `${s.from}>${s.to}`]);
        project.dimensions.push({ dimension: s.dimension, from: s.from, to: s.to });
      }
    }

    const bySeverity = (list: { severity: 'critical' | 'high' }[]) => ({
      critical: list.filter((f) => f.severity === 'critical').length,
      high: list.filter((f) => f.severity === 'high').length,
    });
    const found = bySeverity(p.newFindings);
    const foundSum = t.newFindings.severities.reduce((n, s) => n + found[s], 0);
    if (foundSum >= t.newFindings.min) {
      for (const s of t.newFindings.severities)
        if (found[s] > 0) {
          own.push([p.id, `newFindings:${s}`, String(found[s])]);
          project.newFindings[s] = found[s];
        }
    }
    const overdue = bySeverity(p.newlyOverdue ?? []);
    const overdueSum = t.newlyOverdue.severities.reduce((n, s) => n + overdue[s], 0);
    if (overdueSum >= t.newlyOverdue.min) {
      for (const s of t.newlyOverdue.severities)
        if (overdue[s] > 0) {
          own.push([p.id, `newlyOverdue:${s}`, String(overdue[s])]);
          project.newlyOverdue[s] = overdue[s];
        }
    }
    if (t.newErrors.min > 0 && p.newErrors.length >= t.newErrors.min) {
      own.push([p.id, 'newErrors', String(p.newErrors.length)]);
      project.newErrors = p.newErrors.length;
    }
    const expired = p.expiredExceptions?.length ?? 0;
    if (t.expiredExceptions.min > 0 && expired >= t.expiredExceptions.min) {
      own.push([p.id, 'expiredExceptions', String(expired)]);
      project.expiredExceptions = expired;
    }

    if (own.length === 0) continue;
    items.push(...own);
    totals.newCritical += project.newFindings.critical;
    totals.newHigh += project.newFindings.high;
    totals.newlyOverdue += project.newlyOverdue.critical + project.newlyOverdue.high;
    totals.newErrors += project.newErrors;
    totals.expiredExceptions += project.expiredExceptions;
    projects.push(project);
  }

  if (projects.length === 0) return null;
  projects.sort((a, b) => ORDER[a.overall.to] - ORDER[b.overall.to] || a.id.localeCompare(b.id));
  totals.projects = projects.length;
  const shown = projects.slice(0, config.digest.maxProjects);
  return DigestSchema.parse({
    key: changeSetKey(basis.previousCollectedAt, items),
    generatedAt: changes.generatedAt,
    previousCollectedAt: basis.previousCollectedAt,
    locale: config.locale,
    siteUrl: config.siteUrl,
    totals,
    projects: shown,
    omittedProjects: projects.length - shown.length,
  });
}
