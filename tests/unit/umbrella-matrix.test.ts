import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectSnapshotSchema, type ProjectSnapshot } from '@model/index';
import { matrixOf } from '../../src/lib/umbrella-matrix';

const load = (id: string): ProjectSnapshot =>
  ProjectSnapshotSchema.parse(
    JSON.parse(readFileSync(join('fixtures/snapshots/projects', `${id}.json`), 'utf8')),
  );
const alpha = load('project-alpha');
const beta = load('project-beta');
const clone = (s: ProjectSnapshot): ProjectSnapshot => structuredClone(s);

describe('matrixOf (components by environment)', () => {
  it('is null without an umbrella chart', () => {
    for (const id of ['platform', 'project-beta', 'project-gamma'])
      expect(matrixOf(load(id))).toBeNull();
  });

  it('lists the umbrella components of Alpha with one column per environment', () => {
    const m = matrixOf(alpha)!;
    expect(m.environments.map((e) => e.id)).toEqual(alpha.environments.map((e) => e.id));
    const inChart = alpha.components.filter((c) => c.umbrella?.inUmbrella).map((c) => c.id);
    expect(m.rows.map((r) => r.componentId)).toEqual(inChart);
    // Each environment column carries the ref the chart was read at.
    for (const e of m.environments) {
      const env = alpha.environments.find((x) => x.id === e.id)!;
      expect(e.ref).toBe(env.componentVersions?.ref ?? null);
    }
  });

  it('marks the frontend: latest release above main, PROD below the column on its left', () => {
    const m = matrixOf(alpha)!;
    const fe = m.rows.find((r) => r.componentId === 'frontend')!;
    const component = alpha.components.find((c) => c.id === 'frontend')!;
    expect(fe.latest).toBe(component.latestRelease!.tag);
    expect(fe.main).toBe(component.umbrella!.main);
    expect(fe.latestWaiting).toBe(true);
    const prod = m.environments.findIndex((e) => e.id === 'prod');
    expect(fe.cells[prod]).toEqual({ version: '2.0.3', reason: null, waiting: true });
    // Equal to the column on the left: nothing waiting.
    const dev = m.environments.findIndex((e) => e.id === 'dev');
    expect(fe.cells[dev]).toEqual({ version: '2.1.0', reason: null, waiting: false });
    // Backend: the latest release is what main has.
    const be = m.rows.find((r) => r.componentId === 'backend')!;
    expect(be.latestWaiting).toBe(false);
    expect(be.cells.every((c) => !c.waiting)).toBe(true);
  });

  it('lists the components outside the chart and the unmapped dependencies', () => {
    const m = matrixOf(alpha)!;
    const outside = alpha.components.filter((c) => !c.umbrella?.inUmbrella);
    expect(m.outside.map((o) => o.componentId)).toEqual(outside.map((c) => c.id));
    expect(m.outside[0]).toEqual({
      componentId: outside[0]!.id,
      name: outside[0]!.name,
      version: outside[0]!.effectiveVersion,
    });
    expect(m.unmapped).toEqual(['alpha-legacy-reports']);
  });

  it('reads the column header from the environment source', () => {
    const m = matrixOf(alpha)!;
    const header = Object.fromEntries(m.environments.map((e) => [e.id, e.header]));
    // Argo CD with a version: deployed; versions file and manifest: declared.
    expect(header).toEqual({
      dev: 'deployed',
      test: 'declared',
      uat: 'declared',
      prod: 'deployed',
    });
    expect(m.environments.every((e) => e.branch === null)).toBe(true);
  });

  it('a skipped environment gives skipped cells, never a version', () => {
    const s = clone(alpha);
    const prod = s.environments.find((e) => e.id === 'prod')!;
    prod.componentVersions = { ref: 'v1.3.0', state: 'skipped', versions: [] };
    const m = matrixOf(s)!;
    const i = m.environments.findIndex((e) => e.id === 'prod');
    for (const row of m.rows)
      expect(row.cells[i]).toEqual({ version: null, reason: 'skipped', waiting: false });
  });

  it('a chart that could not be read at an environment gives its state as the reason', () => {
    const s = clone(alpha);
    s.environments.find((e) => e.id === 'test')!.componentVersions = {
      ref: 'v1.4.0',
      state: 'not-authorised',
      versions: [],
    };
    const m = matrixOf(s)!;
    const i = m.environments.findIndex((e) => e.id === 'test');
    expect(m.rows.map((r) => r.cells[i]!.reason)).toEqual(m.rows.map(() => 'not-authorised'));
  });

  it('a conflicting dependency is unknown with the conflict reason', () => {
    const s = clone(alpha);
    const dev = s.environments.find((e) => e.id === 'dev')!;
    dev.componentVersions!.versions = dev.componentVersions!.versions.map((v) =>
      v.componentId === 'backend' ? { ...v, version: null, conflict: true } : v,
    );
    const m = matrixOf(s)!;
    const i = m.environments.findIndex((e) => e.id === 'dev');
    const be = m.rows.find((r) => r.componentId === 'backend')!;
    expect(be.cells[i]).toEqual({ version: null, reason: 'conflict', waiting: false });
  });

  it('a branch environment gives a branch header and no-version cells', () => {
    const s = clone(alpha);
    const lab = structuredClone(beta.environments.find((e) => e.id === 'lab')!);
    expect(lab.componentVersions).toBeNull();
    s.environments = [lab, ...s.environments];
    const m = matrixOf(s)!;
    expect(m.environments[0]).toMatchObject({
      id: 'lab',
      ref: null,
      header: 'branch',
      branch: { ref: 'main', sha: lab.deployment!.revision },
    });
    for (const row of m.rows)
      expect(row.cells[0]).toEqual({ version: null, reason: 'no-version', waiting: false });
    // DEV compares with the nearest version on its left (the umbrella on main), not the dash.
    const fe = m.rows.find((r) => r.componentId === 'frontend')!;
    expect(fe.cells[1]).toEqual({ version: '2.1.0', reason: null, waiting: false });
  });

  it('an environment with no readable version is unknown, never the not-applicable dash', () => {
    const s = clone(alpha);
    const uat = s.environments.find((e) => e.id === 'uat')!;
    uat.version = null;
    uat.status = 'unknown';
    uat.source = 'unknown';
    uat.deployment = null;
    uat.componentVersions = null;
    const m = matrixOf(s)!;
    const i = m.environments.findIndex((e) => e.id === 'uat');
    expect(m.environments[i]).toMatchObject({ ref: null, header: 'unknown', branch: null });
    for (const row of m.rows)
      expect(row.cells[i]).toEqual({ version: null, reason: 'unknown', waiting: false });
  });

  it('an environment below the umbrella on main is marked waiting', () => {
    const s = clone(alpha);
    s.environments.find((e) => e.id === 'dev')!.componentVersions!.versions[1]!.version = '2.0.0';
    const m = matrixOf(s)!;
    const fe = m.rows.find((r) => r.componentId === 'frontend')!;
    expect(fe.cells[0]).toEqual({ version: '2.0.0', reason: null, waiting: true });
    // TEST is above DEV: nothing waiting there.
    expect(fe.cells[1]!.waiting).toBe(false);
  });

  it('never lists a component as outside the umbrella when main could not be read', () => {
    const s = clone(alpha);
    s.coordinator.umbrellaChart = { ...s.coordinator.umbrellaChart!, state: 'not-found' };
    for (const c of s.components)
      if (c.umbrella) c.umbrella = { ...c.umbrella, inUmbrella: false, main: null };
    const m = matrixOf(s)!;
    expect(m.outside).toEqual([]);
    // Rows come from the release and the environment reads instead.
    expect(m.rows.map((r) => r.componentId)).toEqual(['backend', 'frontend', 'worker']);
    expect(m.rows.every((r) => r.main === null && !r.latestWaiting)).toBe(true);
  });
});
