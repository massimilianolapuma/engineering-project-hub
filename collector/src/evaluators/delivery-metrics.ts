/*
 * Delivery metrics of one environment from its deploy events (spec §5.3, C6). Pure.
 * - frequency: deploys in the last `frequencyDays`, per week (0 is a measured zero);
 * - lead time: median hours from the change (commit or release tag) to its deploy;
 * - change failure rate (DevOps Research and Assessment "four keys" definition): deployments that
 *   failed in production over all deployments. A failed run is a failed deployment; a rollback is
 *   the remediation of the deploy it undoes, which counts as failed; the rollback itself is not a
 *   deployment. Capped at 100% (rollbacks of deploys made before the window);
 * - time to restore: median hours from a failure to the next deploy, or from the rolled-back
 *   deploy to the rollback.
 * Argo CD history and releases only show that a deploy happened: frequency only.
 */

export type DeploySignalType = 'workflow' | 'versions-file' | 'argocd' | 'release' | 'external';

export interface DeployEvent {
  at: string;
  kind: 'deploy' | 'failure' | 'rollback';
  version: string | null;
  leadHours: number | null;
}

export interface DeliveryMetrics {
  frequencyPerWeek: number | null;
  leadHoursMedian: number | null;
  cfrPercent: number | null;
  ttrHoursMedian: number | null;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return round1(v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2);
}

export function deliveryMetrics(
  events: readonly DeployEvent[],
  signal: DeploySignalType,
  windows: { frequencyDays: number; trendDays: number },
  now: Date,
): DeliveryMetrics {
  const t = now.getTime();
  const sorted = [...events]
    .filter((e) => Number.isFinite(Date.parse(e.at)) && Date.parse(e.at) <= t)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const inFrequency = sorted.filter(
    (e) => e.kind === 'deploy' && t - Date.parse(e.at) <= windows.frequencyDays * DAY_MS,
  );
  const frequencyPerWeek = Math.round((inFrequency.length / windows.frequencyDays) * 700) / 100;

  const trend = sorted.filter((e) => t - Date.parse(e.at) <= windows.trendDays * DAY_MS);
  if (signal === 'argocd' || signal === 'release' || trend.length === 0)
    return { frequencyPerWeek, leadHoursMedian: null, cfrPercent: null, ttrHoursMedian: null };

  const deploys = trend.filter((e) => e.kind === 'deploy');
  const leadHoursMedian = median(
    deploys.map((e) => e.leadHours).filter((h): h is number => h !== null && h >= 0),
  );
  const failures = trend.filter((e) => e.kind === 'failure').length;
  const failed = failures + trend.filter((e) => e.kind === 'rollback').length;
  const deployments = Math.max(deploys.length + failures, failed);
  const cfrPercent = round1((failed / deployments) * 100);

  const restores: number[] = [];
  trend.forEach((e, i) => {
    if (e.kind === 'failure') {
      const next = trend.slice(i + 1).find((x) => x.kind === 'deploy');
      if (next) restores.push((Date.parse(next.at) - Date.parse(e.at)) / HOUR_MS);
    } else if (e.kind === 'rollback') {
      const undone = trend
        .slice(0, i)
        .reverse()
        .find((x) => x.kind === 'deploy');
      if (undone) restores.push((Date.parse(e.at) - Date.parse(undone.at)) / HOUR_MS);
    }
  });
  return { frequencyPerWeek, leadHoursMedian, cfrPercent, ttrHoursMedian: median(restores) };
}
