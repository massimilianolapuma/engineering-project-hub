import type { EnvironmentSnapshot, ProjectSnapshot } from '@model/index';
import { compareVersions, normaliseVersion } from '../../shared/semver';
import { branchDeployment } from './env-version';

/*
 * Components by environment (Versions page): one row per component of the umbrella chart, one
 * column per environment with the component version the chart pins at the environment's ref.
 * Pure. An unreadable cell carries its reason and is never "not deployed" nor guessed from
 * another column.
 */

/** Where an environment column's version comes from: the header line under its name. */
export type MatrixHeader = 'declared' | 'deployed' | 'branch' | 'unknown';
/** Why a cell has no version. */
export type CellReason =
  | 'not-found'
  | 'invalid'
  | 'not-authorised'
  | 'unknown'
  | 'skipped'
  | 'conflict'
  | 'no-version'
  | null;

export interface MatrixEnvironment {
  id: string;
  name: string;
  /** Ref the chart was read at (e.g. "v1.4.0"); null when the environment has no version. */
  ref: string | null;
  status: EnvironmentSnapshot['status'];
  header: MatrixHeader;
  branch: { ref: string; sha: string } | null;
}
export interface MatrixCell {
  version: string | null;
  reason: CellReason;
  /** Lower (semver) than the nearest version on its left: a newer version is waiting. */
  waiting: boolean;
}
export interface MatrixRow {
  componentId: string;
  name: string;
  /** Latest release tag (e.g. "v2.2.0"). */
  latest: string | null;
  /** Version in the umbrella chart on the default branch. */
  main: string | null;
  /** Why `main` is null: the chart state when it could not be read, or a conflict. */
  mainReason: CellReason;
  cells: MatrixCell[];
  /** The latest release is above the umbrella on main. */
  latestWaiting: boolean;
}
export interface Matrix {
  environments: MatrixEnvironment[];
  rows: MatrixRow[];
  /** Components not in the chart on main (only when main was read). */
  outside: { componentId: string; name: string; version: string | null }[];
  /** Chart dependencies mapped to no component. */
  unmapped: string[];
}

const DECLARED = new Set<EnvironmentSnapshot['source']>(['versions-file', 'manifest']);
const DEPLOYED = new Set<EnvironmentSnapshot['source']>(['argocd', 'github-deployments']);

function headerOf(e: EnvironmentSnapshot, branch: MatrixEnvironment['branch']): MatrixHeader {
  if (branch) return 'branch';
  if (DECLARED.has(e.source)) return 'declared';
  if (DEPLOYED.has(e.source) && e.version) return 'deployed';
  return 'unknown';
}

/** Strictly lower in semver; false when either side is missing or not semver. */
const lower = (a: string | null, b: string | null): boolean =>
  a !== null && b !== null && compareVersions(a, b) === -1;

function cellOf(
  e: EnvironmentSnapshot,
  branch: MatrixEnvironment['branch'],
  componentId: string,
): Omit<MatrixCell, 'waiting'> {
  const read = e.componentVersions;
  // No chart read. A branch deployment (LAB on main) has no release to read the chart at: the
  // not-applicable dash. Any other environment is unknown, never "not deployed".
  if (!read) return { version: null, reason: branch ? 'no-version' : 'unknown' };
  if (read.state !== 'ok') return { version: null, reason: read.state };
  const entry = read.versions.find((v) => v.componentId === componentId);
  if (!entry) return { version: null, reason: 'not-found' };
  if (entry.conflict) return { version: null, reason: 'conflict' };
  return entry.version
    ? { version: entry.version, reason: null }
    : { version: null, reason: 'unknown' };
}

/** The table for a project with an umbrella chart; null without one. */
export function matrixOf(s: ProjectSnapshot): Matrix | null {
  const chart = s.coordinator.umbrellaChart;
  if (!chart) return null;
  // `inUmbrella` is false when the main chart could not be read: membership is then unknown,
  // so rows come from the release and environment reads and nothing is "outside".
  const mainOk = chart.state === 'ok';

  const environments: MatrixEnvironment[] = s.environments.map((e) => {
    const branch = branchDeployment(e);
    return {
      id: e.id,
      name: e.name,
      ref: e.componentVersions?.ref ?? null,
      status: e.status,
      header: headerOf(e, branch),
      branch,
    };
  });

  const readsOf = (id: string) =>
    s.environments.some((e) => e.componentVersions?.versions.some((v) => v.componentId === id));
  const inChart = s.components.filter((c) =>
    mainOk ? c.umbrella?.inUmbrella === true : c.umbrella?.release != null || readsOf(c.id),
  );

  const rows: MatrixRow[] = inChart.map((c) => {
    const main = mainOk ? (c.umbrella?.main ?? null) : null;
    const mainReason: CellReason =
      main !== null
        ? null
        : chart.state !== 'ok'
          ? chart.state
          : c.umbrella?.conflict
            ? 'conflict'
            : 'unknown';
    const latest = c.latestRelease?.tag ?? null;
    // Each environment against the nearest version on its left (the umbrella on main first);
    // a column without a version (a branch, an unreadable chart) is skipped, never guessed.
    let left = main;
    const cells = s.environments.map((e, i) => {
      const cell = cellOf(e, environments[i]!.branch, c.id);
      const waiting = lower(cell.version, left);
      if (cell.version !== null) left = cell.version;
      return { ...cell, waiting };
    });
    return {
      componentId: c.id,
      name: c.name,
      latest,
      main,
      mainReason,
      cells,
      latestWaiting: lower(main, normaliseVersion(latest)),
    };
  });

  const outside = mainOk
    ? s.components
        .filter((c) => c.umbrella?.inUmbrella !== true)
        .map((c) => ({ componentId: c.id, name: c.name, version: c.effectiveVersion }))
    : [];

  return { environments, rows, outside, unmapped: chart.unmapped };
}
