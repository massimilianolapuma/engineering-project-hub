import type { HealthStatus, ProjectSnapshot, WorkflowStatus } from '@model/index';
import { format } from '../i18n';

/**
 * What needs attention on a critical workflow, worst first. `stale` applies only when nothing
 * worse does (a failed run that is also old stays "failed"); `not-visible` is a blind spot
 * (not authorised / unknown), never treated as success.
 */
export const WORKFLOW_ISSUES = [
  'failed',
  'cancelled',
  'missing',
  'never-run',
  'stale',
  'not-visible',
  'running',
] as const;
export type WorkflowIssue = (typeof WORKFLOW_ISSUES)[number];

/** Pill tone per issue: health tones only, unknown is the dashed outline. */
export const ISSUE_TONE: Record<WorkflowIssue, 'red' | 'amber' | 'grey' | 'info'> = {
  failed: 'red',
  cancelled: 'red',
  missing: 'amber',
  'never-run': 'amber',
  stale: 'amber',
  'not-visible': 'grey',
  running: 'info',
};

export function workflowIssue(w: WorkflowStatus): WorkflowIssue | null {
  switch (w.state) {
    case 'failure':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'missing':
      return 'missing';
    case 'never-run':
      return 'never-run';
    case 'not-authorised':
    case 'unknown':
      return 'not-visible';
    default:
      if (w.stale) return 'stale';
      return w.state === 'success' ? null : 'running';
  }
}

export interface WorkflowSummary {
  critical: WorkflowStatus[];
  issues: { workflow: WorkflowStatus; issue: WorkflowIssue }[];
  ok: WorkflowStatus[];
}

/** Only catalog-critical workflows: the problems (worst first) and the ones that succeeded. */
export function summariseWorkflows(s: ProjectSnapshot): WorkflowSummary {
  const critical = s.workflows.filter((w) => w.critical);
  const issues = critical
    .map((workflow, i) => ({ workflow, issue: workflowIssue(workflow), i }))
    .filter((x): x is { workflow: WorkflowStatus; issue: WorkflowIssue; i: number } => !!x.issue)
    .sort(
      (a, b) => WORKFLOW_ISSUES.indexOf(a.issue) - WORKFLOW_ISSUES.indexOf(b.issue) || a.i - b.i,
    )
    .map(({ workflow, issue }) => ({ workflow, issue }));
  const ok = critical.filter((w) => workflowIssue(w) === null);
  return { critical, issues, ok };
}

export function countIssues(projects: ProjectSnapshot[]): Record<WorkflowIssue, number> {
  const counts = Object.fromEntries(WORKFLOW_ISSUES.map((k) => [k, 0])) as Record<
    WorkflowIssue,
    number
  >;
  for (const p of projects) for (const { issue } of summariseWorkflows(p).issues) counts[issue]++;
  return counts;
}

/** Unknown is never calmer than a gap: grey sorts right after the projects with problems. */
const DELIVERY_RANK: Record<HealthStatus, number> = { red: 0, amber: 1, grey: 2, green: 3 };

/** Worst delivery first; ties by score (insufficient data right after red), then by name. */
export function sortProjectsForWorkflows(projects: ProjectSnapshot[]): ProjectSnapshot[] {
  const score = (p: ProjectSnapshot) => p.score.value ?? 49.5;
  return [...projects].sort(
    (a, b) =>
      DELIVERY_RANK[a.deliveryHealth.status] - DELIVERY_RANK[b.deliveryHealth.status] ||
      score(a) - score(b) ||
      a.project.name.localeCompare(b.project.name),
  );
}

const DAY_MS = 86_400_000;

/** Whole days from `from` to `to` (both ISO timestamps). */
export const daysBetween = (from: string, to: string): number =>
  Math.floor((Date.parse(to) - Date.parse(from)) / DAY_MS);

/** Picks the singular or plural form and fills `{n}` (plus any extra placeholders). */
export const plural = (
  forms: { one: string; other: string },
  n: number,
  params: Record<string, string | number> = {},
): string => format(n === 1 ? forms.one : forms.other, { ...params, n });
