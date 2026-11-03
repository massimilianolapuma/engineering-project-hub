import { parseTeamName, teamSlug, type TeamNaming } from '@model/teams';

export interface TeamGroup {
  /** Business unit of the line the teams belong to; null = cross teams. */
  businessUnit: string | null;
  teams: { ref: string; slug: string }[];
}

/**
 * Teams for the Portfolio team filter: grouped by business unit when the naming rule parses
 * them (sorted by unit), cross teams last; slugs sorted within a group, duplicates dropped.
 */
export function groupTeams(refs: string[], naming: TeamNaming | undefined): TeamGroup[] {
  const groups = new Map<string | null, Map<string, { ref: string; slug: string }>>();
  for (const ref of refs) {
    const slug = teamSlug(ref);
    const unit = parseTeamName(slug, naming)?.businessUnit ?? null;
    const group = groups.get(unit) ?? new Map();
    if (!group.has(slug)) group.set(slug, { ref, slug });
    groups.set(unit, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([businessUnit, teams]) => ({
      businessUnit,
      teams: [...teams.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
    }));
}
