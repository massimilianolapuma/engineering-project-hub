import type {
  ComponentSnapshot,
  Pin,
  ProjectSnapshot,
  Reason,
  ReasonLevel,
  Submodule,
} from '@model/index';
import { healthRank } from './format';

/*
 * View model of the Versions page: what to check per project, worst first. Pure functions of
 * the snapshot, so the page only renders. Problems are listed; aligned components are kept
 * apart (collapsed); an unreadable project is never presented as aligned.
 */

/** One problem of a component, explained in a sentence on the page. */
export type VersionIssue =
  /** Release manifest declaration differs from the version the coordinator pins. */
  | { kind: 'mismatch'; declared: string | null; pinned: string | null }
  /** Current version differs from the component's latest release. */
  | { kind: 'drift'; current: string | null; latest: string | null }
  /** The pinned submodule commit is not a tag (ahead / behind / diverged / unverifiable). */
  | { kind: 'pin'; pin: Pin; sha: string | null }
  /** The current version could not be read. */
  | { kind: 'unknown' }
  /** The current version is known but the latest release is not (none published, or unreadable). */
  | { kind: 'latestUnknown'; current: string | null }
  /**
   * The coordinator's submodule could not be resolved (`unresolvable`) or read (`unknown`).
   * `level` is the severity the policy gave it, so the pill matches the card status.
   */
  | {
      kind: 'submodule';
      status: 'unresolvable' | 'unknown';
      path: string;
      level: ReasonLevel;
    };

export type CheckRow =
  | { kind: 'component'; component: ComponentSnapshot; issues: VersionIssue[] }
  /** A submodule in `.gitmodules` that no catalog component claims. */
  | { kind: 'unmapped'; submodule: Submodule }
  /** A mapped submodule that cannot be resolved or read and no component row carries. */
  | { kind: 'submodule'; submodule: Submodule; issue: VersionIssue };

export interface VersionCard {
  /** `unknown`: dashed card with the cause. `aligned`: one line. `check`: full card. */
  kind: 'unknown' | 'aligned' | 'check';
  rows: CheckRow[];
  aligned: ComponentSnapshot[];
  /** The version shared by every environment, when they all report the same one. */
  sameEnvVersion: string | null;
}

/** Version without a leading `v`, so `v3.2.0` and `3.2.0` compare equal. */
const bare = (x: string | null | undefined) => x?.replace(/^v/i, '') ?? null;

/** Issue of a submodule that is mapped but not resolved; null when it is resolved. */
export function submoduleIssue(sub: Submodule, reasons: Reason[] = []): VersionIssue | null {
  if (sub.status === 'resolved') return null;
  // Unresolvable: the level the policy set (red by default). Unknown is never calmer than grey.
  const level =
    sub.status === 'unresolvable'
      ? (reasons.find((r) => r.code === 'submodule-unresolvable' && r.params.path === sub.path)
          ?.level ?? 'red')
      : 'grey';
  return { kind: 'submodule', status: sub.status, path: sub.path, level };
}

/**
 * Problems of one component. `reasons` (the project's version health reasons) give the
 * policy level of an unresolvable submodule; without them it defaults to red.
 */
export function componentIssues(c: ComponentSnapshot, reasons: Reason[] = []): VersionIssue[] {
  const issues: VersionIssue[] = [];
  const mismatch = c.manifestConsistency === 'mismatch';
  if (mismatch)
    issues.push({
      kind: 'mismatch',
      declared: c.declaredVersion,
      pinned: c.pin?.version ?? c.effectiveVersion,
    });
  // Say one thing first: when the mismatch already shows the gap to the latest release
  // (the manifest declares it, the coordinator still pins the older one), drift repeats it.
  const driftRepeatsMismatch =
    mismatch &&
    c.declaredVersion !== null &&
    bare(c.declaredVersion) === bare(c.latestRelease?.tag);
  if (c.drift === 'drift' && !driftRepeatsMismatch)
    issues.push({
      kind: 'drift',
      current: c.effectiveVersion,
      latest: c.latestRelease?.tag ?? null,
    });
  const sub = c.submodule && c.submodule.association !== 'unmapped' ? c.submodule : null;
  const subIssue = sub ? submoduleIssue(sub, reasons) : null;
  if (subIssue) issues.push(subIssue);
  // An unresolved submodule has no commit to verify: the pin issue would only repeat it.
  if (c.pin && c.pin.status !== 'tagged' && !(subIssue && c.pin.status === 'unknown'))
    issues.push({ kind: 'pin', pin: c.pin, sha: c.submodule?.sha ?? null });
  if (c.effectiveVersion === null) issues.push({ kind: 'unknown' });
  // Drift is unknown when the latest release is missing: never count that as aligned.
  else if (c.drift === 'unknown')
    issues.push({ kind: 'latestUnknown', current: c.effectiveVersion });
  return issues;
}

export function versionCard(s: ProjectSnapshot): VersionCard {
  const rows: CheckRow[] = [];
  const aligned: ComponentSnapshot[] = [];
  for (const component of s.components) {
    const issues = componentIssues(component, s.versionHealth.reasons);
    if (issues.length > 0) rows.push({ kind: 'component', component, issues });
    else aligned.push(component);
  }
  const carried = new Set(s.components.map((c) => c.submodule?.path).filter(Boolean));
  for (const submodule of s.coordinator.submodules) {
    if (submodule.association === 'unmapped') {
      rows.push({ kind: 'unmapped', submodule });
      continue;
    }
    // A mapped submodule that cannot be resolved is a cause of the card status: always list it.
    const issue = carried.has(submodule.path)
      ? null
      : submoduleIssue(submodule, s.versionHealth.reasons);
    if (issue) rows.push({ kind: 'submodule', submodule, issue });
  }

  const versions = new Set(s.environments.map((e) => e.version));
  const [only] = [...versions];
  const sameEnvVersion = versions.size === 1 && only ? only : null;
  const envsAligned = s.environments.every((e) => e.status === 'aligned');

  const kind: VersionCard['kind'] =
    s.versionHealth.status === 'grey'
      ? 'unknown'
      : rows.length === 0 && envsAligned && s.versionHealth.status === 'green'
        ? 'aligned'
        : 'check';
  return { kind, rows, aligned, sameEnvVersion };
}

/**
 * Headline counts: projects with an environment behind, mismatching declarations, unreadable
 * projects, and `otherCheck`: projects to check that none of the first two counts covers, so
 * the sentence never under-reports.
 */
export function versionsLead(projects: ProjectSnapshot[]) {
  let behind = 0;
  let mismatch = 0;
  let unknown = 0;
  let otherCheck = 0;
  for (const s of projects) {
    if (s.versionHealth.status === 'grey') {
      unknown += 1;
      continue;
    }
    const isBehind = s.environments.some((e) => e.status === 'behind');
    const mismatches = s.components.filter((c) => c.manifestConsistency === 'mismatch').length;
    if (isBehind) behind += 1;
    mismatch += mismatches;
    if (!isBehind && mismatches === 0 && versionCard(s).kind === 'check') otherCheck += 1;
  }
  return { behind, mismatch, unknown, otherCheck };
}

/**
 * Worst first: version health (red, amber, unknown, healthy), then the project score
 * (insufficient data ranks right after red, as on the portfolio), then name.
 */
export function compareVersionCards(a: ProjectSnapshot, b: ProjectSnapshot): number {
  // Same rule as scoreSortKey in src/lib/score.ts (Task 4); switch to it once that lands.
  const key = (s: ProjectSnapshot) => s.score.value ?? 49.5;
  return (
    healthRank(a.versionHealth.status) - healthRank(b.versionHealth.status) ||
    key(a) - key(b) ||
    a.project.name.localeCompare(b.project.name)
  );
}

/** Singular / plural form; `{n}` is replaced by the count. */
export const plural = (n: number, forms: { one: string; other: string }) =>
  (n === 1 ? forms.one : forms.other).replace(/\{n\}/g, String(n));
