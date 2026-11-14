import { compareVersions, normaliseVersion, parseVersion } from './semver';

/** Tags whose reachability from the default branch is checked before giving up. */
export const MAX_TAG_CANDIDATES = 5;

/**
 * Orders tags for the "latest tag" fallback: semver tags first, highest first, then the others
 * in the order GitHub listed them. GitHub's own order is not by version or date, so its first
 * entry may be any tag (for example one imported from another project).
 */
export function orderTagCandidates<T extends { name: string }>(tags: readonly T[]): T[] {
  const semver = (t: T) => {
    const v = normaliseVersion(t.name);
    return v && parseVersion(v) ? v : null;
  };
  const versioned = tags
    .map((t) => ({ t, v: semver(t) }))
    .filter((x): x is { t: T; v: string } => x.v !== null)
    .sort((a, b) => compareVersions(b.v, a.v) ?? 0)
    .map((x) => x.t);
  return [...versioned, ...tags.filter((t) => semver(t) === null)];
}
