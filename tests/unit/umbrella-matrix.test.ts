import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectSnapshotSchema, type ProjectSnapshot } from '@model/index';
import { hasMatrix, matrixOf } from '../../src/lib/umbrella-matrix';

const load = (id: string): ProjectSnapshot =>
  ProjectSnapshotSchema.parse(
    JSON.parse(readFileSync(join('fixtures/snapshots/projects', `${id}.json`), 'utf8')),
  );
const alpha = load('project-alpha');
const beta = load('project-beta');
const clone = (s: ProjectSnapshot): ProjectSnapshot => structuredClone(s);

describe('matrixOf (components by environment)', () => {
  it('is null without an umbrella chart and without flagged components', () => {
    for (const id of ['platform', 'project-beta', 'project-gamma']) {
      expect(matrixOf(load(id))).toBeNull();
      expect(hasMatrix(load(id))).toBe(false);
    }
    expect(hasMatrix(alpha)).toBe(true);
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
    // Without its own deployments, the helm component is only "outside the umbrella".
    const s = clone(alpha);
    s.components.find((c) => c.id === 'helm')!.environmentVersions = null;
    const m = matrixOf(s)!;
    expect(m.own).toEqual([]);
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

  it('a non-semver version (a range) never produces a waiting marker', () => {
    const s = clone(alpha);
    const fe = s.components.find((c) => c.id === 'frontend')!;
    fe.umbrella = { ...fe.umbrella!, main: '~2.1.0' };
    s.environments.find((e) => e.id === 'dev')!.componentVersions!.versions[1]!.version = '^2.0.0';
    const row = matrixOf(s)!.rows.find((r) => r.componentId === 'frontend')!;
    expect(row.latestWaiting).toBe(false);
    expect(row.cells[0]).toMatchObject({ version: '^2.0.0', waiting: false });
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

  // Components deployed on their own (spec 2026-11-20 §5.4).
  const own = (s: ProjectSnapshot, id = 'helm') =>
    matrixOf(s)!.own.find((r) => r.componentId === id)!;
  const entry = (
    environmentId: string,
    over: Partial<
      NonNullable<ProjectSnapshot['components'][number]['environmentVersions']>[number]
    >,
  ) => ({
    environmentId,
    environment: environmentId,
    state: 'ok' as const,
    version: null,
    ref: null,
    revision: null,
    deployedAt: null,
    declared: false,
    ...over,
  });

  it('Alpha: helm is an own row, not outside the umbrella', () => {
    const m = matrixOf(alpha)!;
    expect(m.hasUmbrella).toBe(true);
    expect(m.own.map((r) => r.componentId)).toEqual(['helm']);
    expect(m.outside).toEqual([]);
    expect(m.rows.some((r) => r.componentId === 'helm')).toBe(false);
    const row = own(alpha);
    expect(row.latest).toBe('v0.9.0');
    expect(row.cells.map((c) => [c.state, c.version, c.declared, c.environment])).toEqual([
      ['ok', null, false, 'dev'],
      ['ok', '0.9.0', false, 'test'],
      ['ok', '0.8.0', true, 'uat'],
      ['ok', '0.8.0', false, 'production'],
    ]);
    // A deployment from a branch has no version: the branch and the short commit instead.
    expect(row.cells[0]!.branch).toMatchObject({ ref: 'main' });
    expect(row.cells[0]!.branch!.sha).toMatch(/^[0-9a-f]{7}$/);
    expect(row.cells[1]!.branch).toBeNull();
    expect(row.cells[1]!.deployedAt).not.toBeNull();
  });

  it('marks an own cell below the nearest version on its left, starting from the latest release', () => {
    // Alpha: latest v0.9.0, DEV on a branch (skipped), TEST 0.9.0, UAT 0.8.0, PROD 0.8.0.
    expect(own(alpha).cells.map((c) => c.waiting)).toEqual([false, false, true, false]);
    // The first environment already behind the latest release waits there; a cell without a
    // version (a branch deployment) is skipped, so PROD is compared with TEST.
    const s = clone(alpha);
    s.components.find((c) => c.id === 'helm')!.environmentVersions = [
      entry('dev', { version: '0.8.0' }),
      entry('test', { version: '0.8.0' }),
      entry('uat', { ref: 'main', revision: 'abcdef0' }),
      entry('prod', { version: '0.7.0' }),
    ];
    expect(own(s).cells.map((c) => c.waiting)).toEqual([true, false, false, true]);
  });

  it('builds the table for a project without an umbrella chart', () => {
    const s = clone(beta);
    const first = s.components[0]!;
    first.environmentVersions = s.environments.map((e) => entry(e.id, { version: '1.0.0' }));
    expect(hasMatrix(s)).toBe(true);
    const m = matrixOf(s)!;
    expect(m.hasUmbrella).toBe(false);
    expect(m.rows).toEqual([]);
    expect(m.outside).toEqual([]);
    expect(m.unmapped).toEqual([]);
    expect(m.own.map((r) => r.componentId)).toEqual([first.id]);
    expect(m.environments.map((e) => e.id)).toEqual(s.environments.map((e) => e.id));
  });

  it('none, no-success and failed reads keep their state and never a version', () => {
    const s = clone(alpha);
    s.components.find((c) => c.id === 'helm')!.environmentVersions = [
      entry('dev', { state: 'none' }),
      entry('test', { state: 'no-success' }),
      entry('uat', { state: 'not-authorised' }),
      entry('prod', { state: 'unknown' }),
    ];
    expect(own(s).cells.map((c) => [c.state, c.version, c.branch, c.waiting])).toEqual([
      ['none', null, null, false],
      ['no-success', null, null, false],
      ['not-authorised', null, null, false],
      ['unknown', null, null, false],
    ]);
  });

  it('an environment the component was not read for is unknown, never "none"', () => {
    const s = clone(alpha);
    const helm = s.components.find((c) => c.id === 'helm')!;
    helm.environmentVersions = helm.environmentVersions!.filter((e) => e.environmentId !== 'uat');
    const uat = s.environments.findIndex((e) => e.id === 'uat');
    expect(own(s).cells).toHaveLength(s.environments.length);
    expect(own(s).cells[uat]).toMatchObject({ state: 'unknown', version: null });
  });

  it('never lists a flagged component among the umbrella rows when main could not be read', () => {
    const s = clone(alpha);
    s.coordinator.umbrellaChart = { ...s.coordinator.umbrellaChart!, state: 'not-found' };
    for (const c of s.components)
      if (c.umbrella) c.umbrella = { ...c.umbrella, inUmbrella: false, main: null };
    // The backend was read on its own (the chart being unreadable, the flag decides).
    const backend = s.components.find((c) => c.id === 'backend')!;
    backend.environmentVersions = s.environments.map((e) => entry(e.id, { version: '1.4.0' }));
    const m = matrixOf(s)!;
    expect(m.rows.map((r) => r.componentId)).toEqual(['frontend', 'worker']);
    expect(m.own.map((r) => r.componentId)).toEqual(['backend', 'helm']);
  });
});
