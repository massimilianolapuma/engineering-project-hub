import type {
  Dimension,
  HealthResult,
  HealthStatus,
  Policies,
  ProjectScore,
  ReasonCode,
} from '@model/index';

/**
 * Reasons that make a dimension grey only because there is nothing to measure. Such a
 * dimension is "not applicable": excluded from both measured and required, so it never
 * lowers confidence. Grey for any other reason (not authorised, unknown, failed) is
 * "not measured".
 */
export const NOT_APPLICABLE_REASON_CODES: readonly ReasonCode[] = ['no-critical-workflows'];

function isNotApplicable(result: HealthResult): boolean {
  if (result.status !== 'grey') return false;
  const relevant = result.reasons.filter((r) => r.level !== 'info');
  return relevant.length > 0 && relevant.every((r) => NOT_APPLICABLE_REASON_CODES.includes(r.code));
}

/**
 * Project score (0–100) for ranking and comparing projects in one snapshot.
 *
 * - Weighted mean of the points of the measured required dimensions (grey is excluded,
 *   never counted as 0).
 * - Capped by the overall status so the number agrees with it (red ≤ 49, amber/grey ≤ 89 by
 *   default); a green project is therefore the only one that can reach 100.
 * - null ("insufficient data") when fewer than `minMeasuredRatio` of the required dimensions
 *   were measured.
 */
export function evaluateScore(
  dimensions: Record<Dimension, HealthResult>,
  overall: HealthStatus,
  policies: Policies,
): ProjectScore {
  const { weights, points, caps, minMeasuredRatio } = policies.score;
  const required = [...new Set(policies.overall.requiredDimensions)].filter(
    (d) => !isNotApplicable(dimensions[d]),
  );
  const measured = required.filter((d) => dimensions[d].status !== 'grey');

  const result = (value: number | null): ProjectScore => ({
    value,
    measured: measured.length,
    required: required.length,
  });

  if (required.length === 0 || measured.length / required.length < minMeasuredRatio) {
    return result(null);
  }

  let weighted = 0;
  let totalWeight = 0;
  for (const d of measured) {
    const status = dimensions[d].status as Exclude<HealthStatus, 'grey'>;
    weighted += weights[d] * points[status];
    totalWeight += weights[d];
  }
  if (totalWeight === 0) return result(null);

  const cap = overall === 'green' ? 100 : caps[overall];
  return result(Math.min(Math.round(weighted / totalWeight), cap));
}
