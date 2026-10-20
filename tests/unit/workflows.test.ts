import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ProjectSnapshotSchema,
  type ProjectSnapshot,
  type WorkflowState,
  type WorkflowStatus,
} from '@model/index';
import {
  countIssues,
  daysBetween,
  plural,
  sortProjectsForWorkflows,
  summariseWorkflows,
  workflowIssue,
} from '../../src/lib/workflows';

const load = (id: string): ProjectSnapshot =>
  ProjectSnapshotSchema.parse(
    JSON.parse(readFileSync(join('fixtures/snapshots/projects', `${id}.json`), 'utf8')),
  );
const ALL = ['platform', 'project-alpha', 'project-beta', 'project-gamma'].map(load);
const byId = (id: string) => ALL.find((p) => p.project.id === id)!;

const wf = (state: WorkflowState, extra: Partial<WorkflowStatus> = {}): WorkflowStatus => ({
  workflowId: 'ci',
  name: 'CI',
  file: 'ci.yml',
  critical: true,
  componentId: 'api',
  repository: 'example-org/demo-api',
  branch: 'main',
  state,
  stale: false,
  latestRun: null,
  lastCompletedRun: null,
  lastFailedRun: null,
  activeRun: null,
  lastError: null,
  ...extra,
});

describe('workflow issues', () => {
  it('classifies every workflow state, stale only when nothing worse applies', () => {
    expect(workflowIssue(wf('success'))).toBeNull();
    expect(workflowIssue(wf('success', { stale: true }))).toBe('stale');
    expect(workflowIssue(wf('failure', { stale: true }))).toBe('failed');
    expect(workflowIssue(wf('cancelled'))).toBe('cancelled');
    expect(workflowIssue(wf('missing'))).toBe('missing');
    expect(workflowIssue(wf('never-run'))).toBe('never-run');
    expect(workflowIssue(wf('not-authorised'))).toBe('not-visible');
    expect(workflowIssue(wf('unknown'))).toBe('not-visible');
    expect(workflowIssue(wf('in-progress'))).toBe('running');
    expect(workflowIssue(wf('queued'))).toBe('running');
  });

  it('keeps only critical workflows and lists problems worst first', () => {
    const beta = summariseWorkflows(byId('project-beta'));
    expect(beta.critical).toHaveLength(6);
    expect(beta.issues.map((i) => [i.issue, i.workflow.file, i.workflow.repository])).toEqual([
      ['failed', 'ci-main.yml', 'example-org/project-beta-api'],
      ['missing', 'rel-release.yml', 'example-org/project-beta-web'],
      ['stale', 'cd.yml', 'example-org/project-beta-helm'],
    ]);
    expect(beta.ok).toHaveLength(3);
    const alpha = summariseWorkflows(byId('project-alpha'));
    expect([alpha.critical.length, alpha.issues.length, alpha.ok.length]).toEqual([8, 0, 8]);
    const gamma = summariseWorkflows(byId('project-gamma'));
    expect(gamma.issues.map((i) => i.issue)).toEqual(['not-visible']);
    const nonCritical = summariseWorkflows({
      ...byId('project-beta'),
      workflows: [wf('failure', { critical: false })],
    });
    expect([nonCritical.critical.length, nonCritical.issues.length]).toEqual([0, 0]);
  });

  it('counts portfolio issues by kind', () => {
    expect(countIssues(ALL)).toMatchObject({
      failed: 1,
      missing: 1,
      stale: 1,
      'not-visible': 1,
      cancelled: 0,
      'never-run': 0,
      running: 0,
    });
  });

  it('sorts projects worst delivery first, unknown before healthy, then by score', () => {
    expect(sortProjectsForWorkflows(ALL).map((p) => p.project.id)).toEqual([
      'project-beta',
      'project-gamma',
      'project-alpha',
      'platform',
    ]);
  });

  it('computes whole days between two timestamps and picks plural forms', () => {
    expect(daysBetween('2025-12-26T12:00:00.000Z', '2026-01-15T12:00:00.000Z')).toBe(20);
    const forms = { one: '1 workflow', other: '{n} workflows' };
    expect(plural(forms, 1)).toBe('1 workflow');
    expect(plural(forms, 3)).toBe('3 workflows');
    expect(plural(forms, 0)).toBe('0 workflows');
  });
});
