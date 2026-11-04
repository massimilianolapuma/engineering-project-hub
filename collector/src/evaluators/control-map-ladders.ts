import type { CheckId, Level } from '@model/index';

/*
 * Default level ladders of the control map (spec §5.2), from the assessment targets. `up`: higher
 * is better, level n when value ≥ bounds[n-1], 0 below bounds[0]. `down`: lower is better, level n
 * when value ≤ bounds[n-1] (checked from 5 down), 1 otherwise. bounds are for levels 1–5.
 * Checks with a bespoke rule (license policy, vulnerability age, exposed secrets, secret scanning
 * with push protection, environment separation) compute their level in the evaluator.
 */
const EPS = 1e-9;

export interface Ladder {
  dir: 'up' | 'down';
  bounds: readonly [number, number, number, number, number];
}

const pct = (l4: number): Ladder => ({ dir: 'up', bounds: [EPS, 25, 50, l4, 100] });

export const LADDERS: Partial<Record<CheckId, Ladder>> = {
  'sbom-coverage': pct(85),
  'image-signature': pct(85),
  'build-provenance': pct(85),
  'dependency-scanning': pct(90),
  sast: pct(90),
  'container-scanning': pct(90),
  'iac-scanning': pct(90),
  dast: pct(70),
  'secret-scanning': pct(90),
  'workload-identity': pct(85),
  'branch-protection': pct(90),
  'required-checks': pct(85),
  'pipeline-integrity': pct(85),
  'config-drift': pct(95),
  'evidence-freshness': { dir: 'up', bounds: [EPS, 50, 75, 90, 100] },
  'test-coverage': { dir: 'up', bounds: [EPS, 30, 60, 80, 90] },
  // Deploys per week: > 0, ≥ 1 a month, ≥ 1 a week, ≥ 2 a week, ≥ 1 a day.
  'deploy-frequency': { dir: 'up', bounds: [EPS, 12 / 52, 1, 2, 7] },
  // Hours: > 30 d, ≤ 30 d, ≤ 7 d, ≤ 24 h, ≤ 1 h.
  'lead-time': { dir: 'down', bounds: [Infinity, 720, 168, 24, 1] },
  // Percent of deploys that failed or were rolled back.
  'change-failure-rate': { dir: 'down', bounds: [Infinity, 45, 30, 15, 5] },
  // Hours from a failure to the next good deploy.
  'time-to-restore': { dir: 'down', bounds: [Infinity, 168, 24, 8, 1] },
  // Days to close critical/high alerts.
  'security-mttr': { dir: 'down', bounds: [Infinity, 90, 30, 7, 1] },
};

/** Level of a measured value, and the bound that set it (null at the bottom of the ladder). */
export function levelFor(
  check: CheckId,
  value: number,
  override?: readonly number[],
): { level: Level; threshold: number | null } {
  const ladder = LADDERS[check];
  if (!ladder) throw new Error(`no ladder for ${check}`);
  const bounds = (override ?? ladder.bounds) as readonly number[];
  if (ladder.dir === 'up') {
    for (let n = 5; n >= 1; n--)
      if (value >= bounds[n - 1]!)
        return { level: n as Level, threshold: bounds[n - 1] === EPS ? 0 : bounds[n - 1]! };
    return { level: 0, threshold: null };
  }
  for (let n = 5; n >= 2; n--)
    if (value <= bounds[n - 1]!) return { level: n as Level, threshold: bounds[n - 1]! };
  return { level: 1, threshold: null };
}
