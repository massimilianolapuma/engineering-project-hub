import type {
  ComponentEnvironmentVersion,
  EnvironmentSnapshot,
  ProjectSnapshot,
} from '@model/index';
import { compareVersions, normaliseVersion, parseVersion } from '../../shared/semver';
import { branchDeployment } from './env-version';

/*
 * Components by environment (Versions page): one row per component of the umbrella chart, one
 * column per environment with the component version the chart pins at the environment's ref.
 * Components deployed on their own (catalog `deployments: true`) are a second group of rows,
 * read from the GitHub Deployments of their repository. Pure. An unreadable cell carries its
 * reason and is never "not deployed" nor guessed from another column.
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
/** A cell of a component deployed on its own: what its GitHub Deployments say. */
export interface OwnCell {
  state: ComponentEnvironmentVersion['state'];
  version: string | null;
  /** A successful deployment made from a branch (no version): its ref and short commit. */
  branch: { ref: string; sha: string } | null;
  /** A successful deployment recorded by commit only (no version, no branch or tag): its short SHA. */
  commit: string | null;
  /** Declared by hand, not reported by a pipeline. */
  declared: boolean;
  deployedAt: string | null;
  /** GitHub environment name that was read. */
  environment: string;
  /** Lower (semver) than the nearest version on its left, the latest release first. */
  waiting: boolean;
}
export interface OwnRow {
  componentId: string;
  name: string;
  /** Latest release tag (e.g. "v0.9.0"). */
  latest: string | null;
  /** One cell per project environment, in order. */
  cells: OwnCell[];
}
export interface Matrix {
  /** False for a project without an umbrella chart: only the own rows exist. */
  hasUmbrella: boolean;
  environments: MatrixEnvironment[];
  rows: MatrixRow[];
  /** Components deployed on their own, never also in `rows` or `outside`. */
  own: OwnRow[];
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

/**
 * The version a release tag names: the tag without its `v`, else the semver it ends with
 * ("backend-v1.4.0" → "1.4.0"). The snapshot does not carry the component's tag prefix.
 */
function releaseVersion(tag: string | null): string | null {
  const plain = normaliseVersion(tag);
  if (plain === null || parseVersion(plain)) return plain;
  const tail = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(plain);
  return tail ? tail[1]! : plain;
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

/** The page shows the table: an umbrella chart, or at least one component deployed on its own. */
export function hasMatrix(s: ProjectSnapshot): boolean {
  return (
    s.coordinator.umbrellaChart != null || s.components.some((c) => c.environmentVersions != null)
  );
}

function ownRows(s: ProjectSnapshot): OwnRow[] {
  return s.components
    .filter((c) => c.environmentVersions != null)
    .map((c) => {
      const latest = c.latestRelease?.tag ?? null;
      // Each environment against the nearest version on its left, the latest release first; a
      // cell without a version is skipped, never guessed.
      let left = releaseVersion(latest);
      const cells = s.environments.map((e): OwnCell => {
        const read = c.environmentVersions!.find((v) => v.environmentId === e.id);
        // No read for this environment: unknown, never "no deployment recorded".
        if (!read)
          return {
            state: 'unknown',
            version: null,
            branch: null,
            commit: null,
            declared: false,
            deployedAt: null,
            environment: e.id,
            waiting: false,
          };
        const ok = read.state === 'ok';
        const version = ok ? read.version : null;
        const waiting = lower(version, left);
        if (version !== null) left = version;
        const branch =
          ok && !version && read.ref && read.revision
            ? { ref: read.ref, sha: read.revision }
            : null;
        return {
          state: read.state,
          version,
          branch,
          commit: ok && !version && !branch ? read.revision : null,
          declared: ok && read.declared,
          deployedAt: ok ? read.deployedAt : null,
          environment: read.environment,
          waiting,
        };
      });
      return { componentId: c.id, name: c.name, latest, cells };
    });
}

/** The table of a project with an umbrella chart or own-deployment components; null otherwise. */
export function matrixOf(s: ProjectSnapshot): Matrix | null {
  if (!hasMatrix(s)) return null;
  const chart = s.coordinator.umbrellaChart;
  // `inUmbrella` is false when the main chart could not be read: membership is then unknown,
  // so rows come from the release and environment reads and nothing is "outside".
  const mainOk = chart?.state === 'ok';
  /** Deployed on its own: its row is in `own`, never among the umbrella rows or "outside". */
  const isOwn = (c: ProjectSnapshot['components'][number]) => c.environmentVersions != null;

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
  const inChart = chart
    ? s.components.filter(
        (c) =>
          !isOwn(c) &&
          (mainOk ? c.umbrella?.inUmbrella === true : c.umbrella?.release != null || readsOf(c.id)),
      )
    : [];

  const rows: MatrixRow[] = inChart.map((c) => {
    const main = mainOk ? (c.umbrella?.main ?? null) : null;
    const mainReason: CellReason =
      main !== null
        ? null
        : chart && chart.state !== 'ok'
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
      latestWaiting: lower(main, releaseVersion(latest)),
    };
  });

  const outside = mainOk
    ? s.components
        .filter((c) => !isOwn(c) && c.umbrella?.inUmbrella !== true)
        .map((c) => ({ componentId: c.id, name: c.name, version: c.effectiveVersion }))
    : [];

  return {
    hasUmbrella: chart != null,
    environments,
    rows,
    own: ownRows(s),
    outside,
    unmapped: chart?.unmapped ?? [],
  };
}
