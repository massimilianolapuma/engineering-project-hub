import type { ComponentSnapshot, Pin, ProjectSnapshot, Submodule } from '@model/index';
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
  | { kind: 'unknown' };

export type CheckRow =
  | { kind: 'component'; component: ComponentSnapshot; issues: VersionIssue[] }
  /** A submodule in `.gitmodules` that no catalog component claims. */
  | { kind: 'unmapped'; submodule: Submodule };

export interface VersionCard {
  /** `unknown`: dashed card with the cause. `aligned`: one line. `check`: full card. */
  kind: 'unknown' | 'aligned' | 'check';
  rows: CheckRow[];
  aligned: ComponentSnapshot[];
  /** The version shared by every environment, when they all report the same one. */
  sameEnvVersion: string | null;
}

export function componentIssues(c: ComponentSnapshot): VersionIssue[] {
  const issues: VersionIssue[] = [];
  if (c.manifestConsistency === 'mismatch')
    issues.push({
      kind: 'mismatch',
      declared: c.declaredVersion,
      pinned: c.pin?.version ?? c.effectiveVersion,
    });
  if (c.drift === 'drift')
    issues.push({
      kind: 'drift',
      current: c.effectiveVersion,
      latest: c.latestRelease?.tag ?? null,
    });
  if (c.pin && c.pin.status !== 'tagged')
    issues.push({ kind: 'pin', pin: c.pin, sha: c.submodule?.sha ?? null });
  if (c.effectiveVersion === null) issues.push({ kind: 'unknown' });
  return issues;
}

export function versionCard(s: ProjectSnapshot): VersionCard {
  const rows: CheckRow[] = [];
  const aligned: ComponentSnapshot[] = [];
  for (const component of s.components) {
    const issues = componentIssues(component);
    if (issues.length > 0) rows.push({ kind: 'component', component, issues });
    else aligned.push(component);
  }
  for (const submodule of s.coordinator.submodules)
    if (submodule.association === 'unmapped') rows.push({ kind: 'unmapped', submodule });

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

/** Headline counts: projects with an environment behind, mismatching declarations, unreadable projects. */
export function versionsLead(projects: ProjectSnapshot[]) {
  let behind = 0;
  let mismatch = 0;
  let unknown = 0;
  for (const s of projects) {
    if (s.versionHealth.status === 'grey') {
      unknown += 1;
      continue;
    }
    if (s.environments.some((e) => e.status === 'behind')) behind += 1;
    mismatch += s.components.filter((c) => c.manifestConsistency === 'mismatch').length;
  }
  return { behind, mismatch, unknown };
}

/**
 * Worst first: version health (red, amber, unknown, healthy), then the project score
 * (insufficient data ranks right after red, as on the portfolio), then name.
 */
export function compareVersionCards(a: ProjectSnapshot, b: ProjectSnapshot): number {
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
