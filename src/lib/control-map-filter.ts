import { normalizeTeams, teamMatch } from './portfolio-filters-core';

/*
 * Pure filters of the control map page (src/scripts/control-map.ts), kept apart from the DOM so
 * they can be unit-tested: business unit, area (column group) and ?team= as on the Portfolio.
 */

const AREAS = new Set([
  'supply-chain',
  'vulnerabilities',
  'secrets',
  'change-access',
  'delivery',
  'evidence',
]);

export interface ControlFilters {
  bu: string | null;
  area: string | null;
  teams: string[];
}

export function parseControlFilters(search: string): ControlFilters {
  const q = new URLSearchParams(search);
  const bu = q.get('bu')?.trim().slice(0, 100) || null;
  const area = q.get('area');
  return {
    bu,
    area: area && AREAS.has(area) ? area : null,
    teams: normalizeTeams(q.getAll('team')),
  };
}

export function rowVisible(row: { bu: string; teams: string[] }, f: ControlFilters): boolean {
  return (f.bu === null || row.bu === f.bu) && teamMatch(f.teams, row.teams);
}
