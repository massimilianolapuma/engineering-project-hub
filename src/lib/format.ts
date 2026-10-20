export const shortSha = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : null);

/** Strips a leading "v" for display consistency. */
export const displayVersion = (v: string | null | undefined) =>
  v ? v.replace(/^v(?=\d)/i, '') : null;

const RANK = { red: 0, amber: 1, grey: 2, green: 3 } as const;
export const healthRank = (s: keyof typeof RANK) => RANK[s];
