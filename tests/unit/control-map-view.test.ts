import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTROL_CHECKS } from '@model/index';
import { buildControlMapView, controlMapAvailable } from '../../src/lib/control-map-view';
import { parseControlFilters, rowVisible } from '../../src/lib/control-map-filter';
import { validateProject } from '../../src/lib/validate';

/*
 * Control map page model (spec §5.5): business-unit groups with their projects, medians per
 * check (C4), area column groups, filters by business unit, area and ?team=.
 */
const ids = ['platform', 'project-alpha', 'project-beta', 'project-gamma'];
const projects = () =>
  ids.map((id) => {
    const r = validateProject(
      readFileSync(join('fixtures/snapshots/projects', `${id}.json`), 'utf8'),
    );
    if (!r.ok) throw new Error(id);
    return r.data;
  });

describe('buildControlMapView', () => {
  it('groups projects by business unit, columns by area in check order', () => {
    const v = buildControlMapView(projects())!;
    expect(v.areas.flatMap((a) => a.checks.map((c) => c.id))).toEqual(
      CONTROL_CHECKS.map((c) => c.id),
    );
    const bus = v.groups.map((g) => g.businessUnit);
    expect(bus).toEqual([...bus].sort((a, b) => a.localeCompare(b)));
    expect(
      v.groups
        .flatMap((g) => g.projects)
        .map((p) => p.id)
        .sort(),
    ).toEqual([...ids].sort());
    for (const g of v.groups) expect(g.median).toHaveLength(25);
  });

  it('a business-unit cell is the median of its projects, null when none is measured', () => {
    const ps = projects();
    const [a, b] = [ps[1]!, ps[2]!];
    const same = (p: (typeof ps)[number]) => ({
      ...p,
      project: { ...p.project, businessUnit: 'Unit' },
    });
    const v = buildControlMapView([same(a), same(b)])!;
    const i = CONTROL_CHECKS.findIndex((c) => c.id === 'sast');
    const levels = [a, b]
      .map((p) => p.controlMap!.cells[i]!.level)
      .filter((l): l is NonNullable<typeof l> => l !== null)
      .map(Number);
    const expected = levels.length
      ? Math.floor(levels.reduce((x, y) => x + y, 0) / levels.length)
      : null;
    expect(v.groups[0]!.median[i]).toBe(expected);
    const gamma = buildControlMapView([same(ps[3]!)])!;
    expect(gamma.groups[0]!.median[CONTROL_CHECKS.findIndex((c) => c.id === 'sast')]).toBeNull();
  });

  it('is null when no project carries a control map (not published)', () => {
    const off = projects().map((p) => ({ ...p, controlMap: null }));
    expect(controlMapAvailable(off)).toBe(false);
    expect(buildControlMapView(off)).toBeNull();
    expect(controlMapAvailable(projects())).toBe(true);
  });
});

describe('filters', () => {
  it('reads business unit, area and teams from the address', () => {
    expect(parseControlFilters('?bu=Payments&area=secrets&team=Platform&team=x')).toEqual({
      bu: 'Payments',
      area: 'secrets',
      teams: ['platform', 'x'],
    });
    expect(parseControlFilters('?area=nope')).toEqual({ bu: null, area: null, teams: [] });
  });

  it('shows a row only when it matches the business unit and one of the teams', () => {
    const row = { bu: 'Payments', teams: ['pay-project-alpha-dev', 'platform'] };
    expect(rowVisible(row, { bu: null, area: null, teams: [] })).toBe(true);
    expect(rowVisible(row, { bu: 'Payments', area: null, teams: ['platform'] })).toBe(true);
    expect(rowVisible(row, { bu: 'Retail', area: null, teams: [] })).toBe(false);
    expect(rowVisible(row, { bu: null, area: null, teams: ['other'] })).toBe(false);
  });
});
