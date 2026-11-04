import {
  CONTROL_AREAS,
  CONTROL_CHECKS,
  teamSlug,
  type CheckDef,
  type ControlArea,
  type ControlCell,
  type Level,
  type ProjectSnapshot,
} from '@model/index';

/*
 * Page model of the control map (spec 2026-11-04 §5.5): business units with their projects
 * nested, columns grouped by area in check order. A business-unit cell is the median of its
 * projects' measured levels (C4), rounded down; null when none is measured.
 */

export interface ControlMapRow {
  id: string;
  name: string;
  businessUnit: string;
  teams: string[];
  score: number | null;
  measured: number;
  applicable: number;
  cells: ControlCell[];
  collectedAt: string;
}

export interface ControlMapGroup {
  businessUnit: string;
  median: (Level | null)[];
  score: number | null;
  projects: ControlMapRow[];
}

export interface ControlMapView {
  areas: { area: ControlArea; checks: CheckDef[] }[];
  groups: ControlMapGroup[];
}

export const controlMapAvailable = (projects: readonly ProjectSnapshot[]): boolean =>
  projects.some((p) => p.controlMap !== null);

function medianDown(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return Math.floor(v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2);
}

export function buildControlMapView(projects: readonly ProjectSnapshot[]): ControlMapView | null {
  if (!controlMapAvailable(projects)) return null;
  const rows: ControlMapRow[] = projects
    .filter((p) => p.controlMap)
    .map((p) => ({
      id: p.project.id,
      name: p.project.name,
      businessUnit: p.project.businessUnit,
      teams: p.project.teams.map(teamSlug),
      score: p.controlMap!.score,
      measured: p.controlMap!.measured,
      applicable: p.controlMap!.applicable,
      cells: p.controlMap!.cells,
      collectedAt: p.generatedAt,
    }));
  const units = [...new Set(rows.map((r) => r.businessUnit))].sort((a, b) => a.localeCompare(b));
  const groups = units.map((businessUnit) => {
    const members = rows
      .filter((r) => r.businessUnit === businessUnit)
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      businessUnit,
      median: CONTROL_CHECKS.map(
        (_, i) =>
          medianDown(
            members.map((m) => m.cells[i]?.level).filter((l): l is Level => typeof l === 'number'),
          ) as Level | null,
      ),
      score: medianDown(members.map((m) => m.score).filter((s): s is number => s !== null)),
      projects: members,
    };
  });
  const areas = CONTROL_AREAS.map((area) => ({
    area,
    checks: CONTROL_CHECKS.filter((c) => c.area === area),
  }));
  return { areas, groups };
}

/** Section of the project page that holds the evidence of a check. */
export function evidenceAnchor(check: CheckDef['id']): string {
  if (check === 'environment-separation' || check === 'config-drift') return 'environments';
  if (check === 'workload-identity') return 'repository-controls';
  if (check === 'test-coverage') return 'h-why';
  switch (CONTROL_CHECKS.find((c) => c.id === check)?.area) {
    case 'supply-chain':
      return 'supply-chain';
    case 'vulnerabilities':
    case 'secrets':
      return 'security';
    case 'change-access':
      return 'repository-controls';
    case 'delivery':
      return 'environments';
    default:
      return 'errors';
  }
}
