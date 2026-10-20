import type { ProjectScore } from '@model/index';

/**
 * Sort key for "worst first" lists (ascending). A project with insufficient data has no score:
 * it sorts right after the red projects (every red score is ≤ 49) and before amber / grey
 * ones, never at the bottom as if it were fine. Ties are broken by name by the caller.
 */
export const scoreSortKey = (score: ProjectScore): number => score.value ?? 49.5;
