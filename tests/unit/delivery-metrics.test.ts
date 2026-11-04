import { describe, expect, it } from 'vitest';
import { deliveryMetrics, type DeployEvent } from '../../collector/src/evaluators/delivery-metrics';

/*
 * Delivery metrics from deploy events (spec §5.3): frequency over `frequencyDays`, the others over
 * `trendDays`. A rollback marks the deploy before it as failed.
 */
const now = new Date('2026-03-01T00:00:00Z');
const windows = { frequencyDays: 30, trendDays: 90 };
const ev = (
  at: string,
  kind: DeployEvent['kind'],
  leadHours: number | null = null,
): DeployEvent => ({
  at,
  kind,
  version: null,
  leadHours,
});

describe('deliveryMetrics', () => {
  it('workflow: success, failure, success 2 h later → TTR 2 h, CFR 33.3', () => {
    const m = deliveryMetrics(
      [
        ev('2026-02-20T08:00:00Z', 'deploy', 10),
        ev('2026-02-21T08:00:00Z', 'failure'),
        ev('2026-02-21T10:00:00Z', 'deploy', 30),
      ],
      'workflow',
      windows,
      now,
    );
    expect(m.cfrPercent).toBe(33.3);
    expect(m.ttrHoursMedian).toBe(2);
    expect(m.leadHoursMedian).toBe(20);
    expect(m.frequencyPerWeek).toBeCloseTo((2 / 30) * 7, 5);
  });

  it('versions file: a rollback counts as a failed change, restored at the rollback', () => {
    const m = deliveryMetrics(
      [
        ev('2026-02-10T00:00:00Z', 'deploy'),
        ev('2026-02-10T06:00:00Z', 'rollback'),
        ev('2026-02-12T00:00:00Z', 'deploy'),
      ],
      'versions-file',
      windows,
      now,
    );
    expect(m.cfrPercent).toBe(33.3);
    expect(m.ttrHoursMedian).toBe(6);
  });

  it('no deploy in the frequency window is a measured 0; the rest need events', () => {
    expect(deliveryMetrics([], 'workflow', windows, now)).toEqual({
      frequencyPerWeek: 0,
      leadHoursMedian: null,
      cfrPercent: null,
      ttrHoursMedian: null,
    });
  });

  it('Argo CD and releases give frequency only', () => {
    const m = deliveryMetrics([ev('2026-02-20T00:00:00Z', 'deploy', 5)], 'argocd', windows, now);
    expect(m).toMatchObject({ leadHoursMedian: null, cfrPercent: null, ttrHoursMedian: null });
    expect(m.frequencyPerWeek).toBeGreaterThan(0);
  });

  it('ignores events outside the trend window', () => {
    const m = deliveryMetrics(
      [ev('2025-01-01T00:00:00Z', 'failure'), ev('2026-02-20T00:00:00Z', 'deploy')],
      'workflow',
      windows,
      now,
    );
    expect(m.cfrPercent).toBe(0);
  });
});
