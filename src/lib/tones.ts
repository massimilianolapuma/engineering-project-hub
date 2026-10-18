import type { ControlState, HealthStatus, Severity, WorkflowState } from '@model/index';

/**
 * Visual tone of a status icon: the four health states, neutral info / muted, and `blind`:
 * a required control the collector could not see (not authorised / unknown). A blind spot is
 * a risk in its own right, so it must never look calmer than an optional gap.
 */
export type Tone = HealthStatus | 'info' | 'muted' | 'blind';

/** Severity has its own scale: it is never rendered with the health tones or icons. */
export type SeverityTone = 'sev-critical' | 'sev-high' | 'sev-medium' | 'sev-low' | 'sev-unknown';

/**
 * Tone of a security control. Salience follows requiredness: a missing optional control is
 * informational (muted), a required one is a gap (amber), and a required control the collector
 * cannot see is a blind spot. `required` defaults to true so callers without the flag never
 * understate a gap.
 */
export const controlTone = (s: ControlState, required = true): Tone => {
  switch (s) {
    case 'enabled':
      return 'green';
    case 'failed':
      return 'red';
    case 'not-applicable':
      return 'muted';
    case 'not-configured':
    case 'configured-not-run':
    case 'stale':
      return required ? 'amber' : 'muted';
    case 'not-authorised':
    case 'unknown':
    case 'collection-failed':
      return required ? 'blind' : 'grey';
  }
};

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
