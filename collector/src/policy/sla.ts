import {
  countsAsOpen,
  type FindingException,
  type FindingSla,
  type Policies,
  type RemediationSummary,
} from '@model/index';
import type { BaseFinding } from './exceptions';
import { DAY_MS } from '../util/clock';

/*
 * Remediation SLAs: pure (spec 5.3). The clock is the alert's own creation time, so the result
 * is deterministic and right even for an alert older than the hub's history. An active
 * exception pauses "overdue" but never resets the clock.
 */

export type SlaClass = 'critical' | 'high' | 'medium' | 'low' | 'secret';
export const SLA_CLASSES: readonly SlaClass[] = ['critical', 'high', 'medium', 'low', 'secret'];

const GITHUB_SOURCES = new Set<BaseFinding['source']>([
  'github-code-scanning',
  'github-dependabot',
  'github-secret-scanning',
]);

/** Secret scanning has its own class (its severity is always unknown); informational has none. */
export function slaClassOf(f: BaseFinding): SlaClass | null {
  if (f.source === 'github-secret-scanning') return 'secret';
  return f.severity === 'critical' ||
    f.severity === 'high' ||
    f.severity === 'medium' ||
    f.severity === 'low'
    ? f.severity
    : null;
}

const noOverdue = () => ({ critical: null, high: null, medium: null, low: null, secret: null });

function slaOf(
  f: BaseFinding & { exception?: FindingException | null },
  policies: Policies,
  now: Date,
): FindingSla {
  const cls = slaClassOf(f);
  const days = cls ? policies.remediation.days[cls] : null;
  const detected = f.detectedAt ? Date.parse(f.detectedAt) : Number.NaN;
  const known = !Number.isNaN(detected);
  const ageDays = known ? Math.max(0, Math.floor((now.getTime() - detected) / DAY_MS)) : null;
  if (!cls || days === null)
    return { state: 'none', days: null, dueAt: null, ageDays, overdueDays: null };
  if (!known) return { state: 'unknown', days, dueAt: null, ageDays: null, overdueDays: null };
  const due = detected + days * DAY_MS;
  const dueAt = new Date(due).toISOString();
  if (f.exception?.state === 'active')
    return { state: 'paused', days, dueAt, ageDays, overdueDays: null };
  if (now.getTime() > due)
    return {
      state: 'overdue',
      days,
      dueAt,
      ageDays,
      overdueDays: Math.floor((now.getTime() - due) / DAY_MS),
    };
  return { state: 'within', days, dueAt, ageDays, overdueDays: null };
}

export function applySla<T extends BaseFinding & { exception?: FindingException | null }>(
  findings: T[],
  policies: Policies,
  now: Date,
  anyAlertSourceReadable: boolean,
): { findings: (T & { sla: FindingSla | null })[]; remediation: RemediationSummary } {
  const { enabled, days } = policies.remediation;
  const slaDays = { ...days };
  if (!enabled) {
    return {
      findings: findings.map((f) => ({ ...f, sla: null })),
      remediation: {
        enabled,
        slaDays,
        overdue: noOverdue(),
        oldestOverdueSince: null,
        slaUnknown: 0,
      },
    };
  }
  const out = findings.map((f) => ({
    ...f,
    sla: f.status === 'open' && GITHUB_SOURCES.has(f.source) ? slaOf(f, policies, now) : null,
  }));
  const overdue = { critical: 0, high: 0, medium: 0, low: 0, secret: 0 };
  let oldest: string | null = null;
  let slaUnknown = 0;
  for (const f of out) {
    if (f.sla?.state === 'unknown') slaUnknown++;
    if (f.sla?.state !== 'overdue' || !countsAsOpen(f)) continue;
    overdue[slaClassOf(f)!]++;
    if (f.sla.dueAt && (oldest === null || f.sla.dueAt < oldest)) oldest = f.sla.dueAt;
  }
  return {
    findings: out,
    remediation: {
      enabled,
      slaDays,
      overdue: anyAlertSourceReadable ? overdue : noOverdue(),
      oldestOverdueSince: anyAlertSourceReadable ? oldest : null,
      slaUnknown,
    },
  };
}
