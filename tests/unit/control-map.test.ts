import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  CatalogSchema,
  PoliciesSchema,
  ProjectSnapshotSchema,
  type ControlCell,
  type ProjectSnapshot,
} from '@model/index';
import {
  businessUnitMedian,
  emptyExtras,
  evaluateControlMap,
  ratioOverReadable,
  scoreOf,
} from '../../collector/src/evaluators/control-map';
import { levelFor } from '../../collector/src/evaluators/control-map-ladders';
import { loadConfig } from '../../collector/src/config/load';

/*
 * Control map evaluator on existing evidence (spec §5.2, §5.4): value → level, partial reads,
 * applicability, score and business-unit median. Unknown is never 0.
 */
const snap = (id: string): ProjectSnapshot =>
  ProjectSnapshotSchema.parse(
    JSON.parse(readFileSync(`fixtures/snapshots/projects/${id}.json`, 'utf8')),
  );
const policies = PoliciesSchema.parse(parse(readFileSync('config/policies.yaml', 'utf8')));
const catalog = async () => (await loadConfig('config')).catalog;
const cell = (cells: ControlCell[], id: string) => cells.find((c) => c.check === id)!;

describe('levelFor', () => {
  it.each([
    ['sbom-coverage', 0, 0],
    ['sbom-coverage', 1, 1],
    ['sbom-coverage', 84.9, 3],
    ['sbom-coverage', 85, 4],
    ['sbom-coverage', 100, 5],
    ['lead-time', 24, 4],
    ['lead-time', 24.1, 3],
    ['lead-time', 1, 5],
    ['change-failure-rate', 5, 5],
    ['change-failure-rate', 50, 1],
    ['deploy-frequency', 2, 4],
    ['deploy-frequency', 0, 0],
    ['test-coverage', 80, 4],
  ] as const)('%s %d → %d', (check, value, level) => {
    expect(levelFor(check, value).level).toBe(level);
  });

  it('honours a policy override', () => {
    expect(levelFor('sbom-coverage', 60, [10, 20, 30, 40, 50]).level).toBe(5);
  });
});

describe('ratioOverReadable', () => {
  it('computes over readable repositories and refuses too few', () => {
    expect(ratioOverReadable(['pass', 'fail', 'unknown'])).toMatchObject({
      value: 50,
      readable: { k: 2, n: 3 },
      reason: null,
    });
    expect(ratioOverReadable(['pass', 'unknown', 'unknown'])).toMatchObject({
      value: null,
      reason: 'too-few-readable',
    });
    expect(ratioOverReadable([])).toMatchObject({ value: null, reason: 'no-object' });
  });
});

describe('scoreOf and businessUnitMedian', () => {
  const c = (level: number | null, state = 'measured'): ControlCell =>
    ({ level, state }) as ControlCell;

  it('averages known applicable levels × 20, null below half measured', () => {
    expect(scoreOf([c(4), c(4), c(2), c(null, 'not-visible')])).toEqual({
      score: 67,
      measured: 3,
      applicable: 4,
    });
    expect(
      scoreOf([c(4), c(null, 'not-visible'), c(null, 'not-visible'), c(null, 'not-visible')]),
    ).toEqual({ score: null, measured: 1, applicable: 4 });
    expect(scoreOf([c(null, 'not-applicable'), c(5)])).toEqual({
      score: 100,
      measured: 1,
      applicable: 1,
    });
  });

  it('takes the median of known levels per check, rounding down', () => {
    expect(businessUnitMedian([[c(4)], [c(2)], [c(null, 'not-visible')]])).toEqual([3]);
    expect(businessUnitMedian([[c(null, 'not-visible')]])).toEqual([null]);
  });
});

describe('evaluateControlMap on the golden snapshots', () => {
  it('produces 25 cells in check order with a score', async () => {
    const cat = await catalog();
    const project = cat.projects.find((p) => p.id === 'platform')!;
    const map = evaluateControlMap(
      { snapshot: snap('platform'), project, extras: emptyExtras() },
      policies,
    );
    expect(map.cells).toHaveLength(25);
    expect(map.cells[0]?.check).toBe('sbom-coverage');
    expect(map.measured).toBeGreaterThan(0);
  });

  it('never shows an unknown as 0: new sources without data are not visible', async () => {
    const cat = await catalog();
    const project = cat.projects.find((p) => p.id === 'platform')!;
    const map = evaluateControlMap(
      { snapshot: snap('platform'), project, extras: emptyExtras() },
      policies,
    );
    expect(cell(map.cells, 'security-mttr')).toMatchObject({ level: null, state: 'not-visible' });
    expect(cell(map.cells, 'deploy-frequency').level).toBeNull();
  });

  it('counts a control the project does not require (required: false)', async () => {
    const cat = await catalog();
    const project = cat.projects.find((p) => p.id === 'project-beta')!;
    const s = snap('project-beta');
    for (const comp of s.securityControls)
      for (const ctl of comp.controls)
        if (ctl.control === 'dast')
          Object.assign(ctl, { required: false, state: 'not-configured' });
    const map = evaluateControlMap({ snapshot: s, project, extras: emptyExtras() }, policies);
    expect(cell(map.cells, 'dast')).toMatchObject({ level: 0, state: 'measured' });
  });

  it('marks a check the catalog excludes as not applicable with its reason', async () => {
    const cat = CatalogSchema.parse(await catalog());
    const project = {
      ...cat.projects.find((p) => p.id === 'project-beta')!,
      controlMap: { notApplicable: [{ check: 'dast' as const, reason: 'no web UI' }] },
    };
    const map = evaluateControlMap(
      { snapshot: snap('project-beta'), project, extras: emptyExtras() },
      policies,
    );
    expect(cell(map.cells, 'dast')).toMatchObject({
      level: null,
      state: 'not-applicable',
      reason: 'catalog-not-applicable',
      note: 'no web UI',
    });
  });

  it('caps secret scanning at 3 when push protection was not read', async () => {
    const cat = await catalog();
    const project = cat.projects.find((p) => p.id === 'platform')!;
    const s = snap('platform');
    for (const comp of s.securityControls)
      for (const ctl of comp.controls) if (ctl.control === 'secretScanning') ctl.state = 'enabled';
    const map = evaluateControlMap({ snapshot: s, project, extras: emptyExtras() }, policies);
    expect(cell(map.cells, 'secret-scanning').level).toBeLessThanOrEqual(3);
    expect(cell(map.cells, 'secret-scanning').note).toContain('push protection');
  });
});
