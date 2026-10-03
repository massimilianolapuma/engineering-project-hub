import type { ControlState, HealthStatus, WorkflowState } from '@model/index';

/** Visual tone of a status icon: the four health states plus neutral info / muted. */
export type Tone = HealthStatus | 'info' | 'muted';

export const controlTone = (s: ControlState): Tone =>
  ({
    enabled: 'green',
    'not-configured': 'amber',
    'configured-not-run': 'amber',
    stale: 'amber',
    failed: 'red',
    'not-authorised': 'grey',
    unknown: 'grey',
    'collection-failed': 'grey',
    'not-applicable': 'muted',
  })[s] as Tone;

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

export const severityTone = (s: string): HealthStatus =>
  s === 'critical' ? 'red' : s === 'high' ? 'amber' : s === 'unknown' ? 'grey' : 'green';
