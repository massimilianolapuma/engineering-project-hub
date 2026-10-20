import type { HealthStatus, Severity, WorkflowState } from '@model/index';

/**
 * Visual tone of a status icon or pill: the four health states plus neutral info / muted.
 * Security controls use the symbols in `symbols.ts`, not these tones.
 */
export type Tone = HealthStatus | 'info' | 'muted';

/** Severity has its own scale: it is never rendered with the health tones or icons. */
export type SeverityTone = 'sev-critical' | 'sev-high' | 'sev-medium' | 'sev-low' | 'sev-unknown';

export const workflowTone = (s: WorkflowState): Tone =>
  ({
    success: 'green',
    failure: 'red',
    cancelled: 'red',
    'in-progress': 'info',
    queued: 'info',
    'never-run': 'amber',
    missing: 'amber',
    'not-authorised': 'grey',
    unknown: 'grey',
  })[s] as Tone;

export const driftTone = (s: 'aligned' | 'drift' | 'unknown' | 'behind' | 'mismatch'): Tone =>
  s === 'aligned' ? 'green' : s === 'unknown' ? 'grey' : 'amber';

export const severityTone = (s: Severity | string): SeverityTone =>
  s === 'critical'
    ? 'sev-critical'
    : s === 'high'
      ? 'sev-high'
      : s === 'medium'
        ? 'sev-medium'
        : s === 'low' || s === 'informational'
          ? 'sev-low'
          : 'sev-unknown';
