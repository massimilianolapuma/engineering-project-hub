import type { SecurityFinding } from '@model/index';
import type { WorkloadIdentity } from '../normalizers/workflow-refs';

/*
 * Pure reductions of the new control map readings (spec §5.2): closed-alert dates into a median
 * time to close, and per-workflow OIDC flags into counts.
 */

const DAY_MS = 86_400_000;

/**
 * Median days from detection to closing, over critical/high alerts closed within `trendDays`
 * before `now`. null when none qualifies (no closed alert, or no dates).
 */
export function medianResolvedDays(
  findings: readonly Pick<SecurityFinding, 'severity' | 'detectedAt' | 'resolvedAt'>[],
  now: Date,
  trendDays: number,
): number | null {
  const since = now.getTime() - trendDays * DAY_MS;
  const days = findings
    .filter((f) => f.severity === 'critical' || f.severity === 'high')
    .flatMap((f) => {
      if (!f.resolvedAt || !f.detectedAt) return [];
      const closed = Date.parse(f.resolvedAt);
      const opened = Date.parse(f.detectedAt);
      if (!Number.isFinite(closed) || !Number.isFinite(opened) || closed < since || closed < opened)
        return [];
      return [(closed - opened) / DAY_MS];
    })
    .sort((a, b) => a - b);
  if (days.length === 0) return null;
  const mid = Math.floor(days.length / 2);
  const median = days.length % 2 ? days[mid]! : (days[mid - 1]! + days[mid]!) / 2;
  return Math.round(median * 10) / 10;
}

/** Deploying and OIDC workflow counts over the parsed files of each repository; null if none read. */
export function workloadIdentityOf(
  repos: readonly (readonly { identity?: WorkloadIdentity | null }[])[],
): { deploying: number; oidc: number } | null {
  const parsed = repos.flat().filter((f) => f.identity);
  if (repos.length === 0) return null;
  return {
    deploying: parsed.filter((f) => f.identity!.deploying).length,
    oidc: parsed.filter((f) => f.identity!.oidc).length,
  };
}
