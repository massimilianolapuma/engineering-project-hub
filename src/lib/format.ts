export const shortSha = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : null);

/** Strips a leading "v" for display consistency. */
export const displayVersion = (v: string | null | undefined) =>
  v ? v.replace(/^v(?=\d)/i, '') : null;

/** Is `iso` older than `hours` relative to `now`? */
export function olderThan(
  iso: string | null | undefined,
  hours: number,
  now = Date.now(),
): boolean {
  if (!iso) return false;
  return now - Date.parse(iso) > hours * 3_600_000;
}

const RANK = { red: 0, amber: 1, grey: 2, green: 3 } as const;
export const healthRank = (s: keyof typeof RANK) => RANK[s];

/** Interpolation params for the coverage counts sentence. */
export const coverageParams = (c: {
  required: number;
  available: number;
  notConfigured: number;
  notAuthorised: number;
  unknown: number;
}) => ({
  required: c.required,
  available: c.available,
  notConfigured: c.notConfigured,
  notAuthorised: c.notAuthorised,
  unknown: c.unknown,
});
