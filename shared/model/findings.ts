/**
 * A finding counts as open when GitHub says so and no active exception accepts it. The
 * exception never changes `status` (the GitHub truth); only this helper decides what is counted.
 */
export const countsAsOpen = (f: {
  status: string;
  exception?: { state: string } | null;
}): boolean => f.status === 'open' && f.exception?.state !== 'active';
