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

/** Longest team slug kept from a link (GitHub slugs are at most 100 characters here). */
const MAX_TEAM_SLUG = 100;

/**
 * `team` values from the link: trimmed, lowercased, without empties or repeats, in first-seen
 * order and at most 100 characters each. The values are only ever shown as text.
 */
export function normalizeTeams(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const slug = v.trim().toLowerCase().slice(0, MAX_TEAM_SLUG);
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

/** A project passes the team filter when nothing is selected or it has a selected team (OR). */
export function teamMatch(selected: string[], projectTeamSlugs: string[]): boolean {
  return selected.length === 0 || projectTeamSlugs.some((s) => selected.includes(s));
}

/**
 * Results line: "{shown} of {total} projects", plus "· N project(s) with unknown counts not
 * shown" when the open-alerts filter hid projects whose counts could not be read, and "· N
 * project(s) without teams not shown" when the team filter hid projects that list no team.
 */
export function resultsLine(
  template: string,
  shown: number,
  total: number,
  unknownHidden: number,
  unknownForms: { one: string; other: string },
  noTeamsHidden = 0,
  noTeamsForms?: { one: string; other: string },
): string {
  let line = template.replace('{shown}', String(shown)).replace('{total}', String(total));
  if (unknownHidden > 0) line += ` · ${plural(unknownHidden, unknownForms)}`;
  if (noTeamsHidden > 0 && noTeamsForms) line += ` · ${plural(noTeamsHidden, noTeamsForms)}`;
  return line;
}
