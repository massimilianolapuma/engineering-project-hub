import { plural } from './version-checks';

/*
 * Pure helpers of the portfolio filters (src/scripts/portfolio-filters.ts), kept apart from the
 * DOM so they can be unit-tested. Open-alert counts arrive from data attributes, -1 = unknown.
 */

/** Result of the open-alerts filter for one project. */
export type SeverityMatch = 'match' | 'miss' | 'unknown';

/**
 * Whether a project passes the open-alerts filter ('' = no filter, 'critical', 'high' = critical
 * or high). A project whose relevant count is unknown is `unknown`, never a silent miss: it is
 * hidden, and the results line says how many projects were left out for that reason.
 */
export function severityMatch(filter: string, critical: number, high: number): SeverityMatch {
  if (filter === 'critical') {
    if (critical > 0) return 'match';
    return critical < 0 ? 'unknown' : 'miss';
  }
  if (filter === 'high') {
    if (critical > 0 || high > 0) return 'match';
    return critical < 0 || high < 0 ? 'unknown' : 'miss';
  }
  return 'match';
}

/**
 * Results line: "{shown} of {total} projects", plus "· N project(s) with unknown counts not
 * shown" when the open-alerts filter hid projects whose counts could not be read.
 */
export function resultsLine(
  template: string,
  shown: number,
  total: number,
  unknownHidden: number,
  unknownForms: { one: string; other: string },
): string {
  const base = template.replace('{shown}', String(shown)).replace('{total}', String(total));
  return unknownHidden > 0 ? `${base} · ${plural(unknownHidden, unknownForms)}` : base;
}
