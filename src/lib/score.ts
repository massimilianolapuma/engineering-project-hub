import type { ProjectScore } from '@model/index';

/**
 * Sort position of a project without a score ("insufficient data"): just above the red cap
 * (49), below any amber or grey score. Unknown is never sorted as zero, nor at the bottom as
 * if it were fine.
 */
export const INSUFFICIENT_DATA_SORT_KEY = 49.5;

/** Portfolio sort key, ascending = worst first. Ties are broken by name by the caller. */
export const scoreSortKey = (score: Pick<ProjectScore, 'value'>): number =>
  score.value ?? INSUFFICIENT_DATA_SORT_KEY;
