export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

/** Strips an optional prefix and a leading "v" (e.g. "backend-v1.2.3" with prefix "backend-"). */
export function normaliseVersion(raw: string | null | undefined, prefix?: string): string | null {
  if (!raw) return null;
  let v = raw.trim();
  if (prefix && v.startsWith(prefix)) v = v.slice(prefix.length);
  if (/^v\d/i.test(v)) v = v.slice(1);
  return v || null;
}

export function parseVersion(v: string): ParsedVersion | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

/** -1 / 0 / 1, or null when either side is not semver (only equality is meaningful then). */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return a === b ? 0 : null;
  for (const k of ['major', 'minor', 'patch'] as const) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}
