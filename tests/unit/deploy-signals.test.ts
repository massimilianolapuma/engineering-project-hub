import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PoliciesSchema, ProjectSnapshotSchema, type ProjectConfig } from '@model/index';
import { collectDeploySignal } from '../../collector/src/collectors/deploy-signals';
import { emptyExtras, evaluateControlMap } from '../../collector/src/evaluators/control-map';
import { deliveryMetrics } from '../../collector/src/evaluators/delivery-metrics';
import { loadConfig } from '../../collector/src/config/load';
import {
  fail,
  ok,
  type SourceProvider,
  type WorkflowRunDTO,
} from '../../collector/src/providers/types';

/*
 * Deploy signals per environment (spec §5.3): versions file at each commit, workflow runs, Argo CD
 * history, releases, external.
 */
const now = new Date('2026-03-01T00:00:00Z');
const windows = { frequencyDays: 30, trendDays: 90 };
const policies = PoliciesSchema.parse(parse(readFileSync('config/policies.yaml', 'utf8')));

const baseProject = async (): Promise<ProjectConfig> =>
  (await loadConfig('config')).catalog.projects.find((p) => p.id === 'project-alpha')!;

const withEnv = (
  p: ProjectConfig,
  deploySignal: ProjectConfig['environments'][number]['deploySignal'],
) => ({
  ...p,
  environments: [{ id: 'prod', name: 'PROD', deploySignal }],
});

describe('versions-file signal', () => {
  const commits = [
    { sha: 'f'.repeat(40), committedAt: '2026-02-20T00:00:00Z', value: 'latest' },
    { sha: 'e'.repeat(40), committedAt: '2026-02-15T00:00:00Z', value: '0.5.1' },
    { sha: 'd'.repeat(40), committedAt: '2026-02-12T00:00:00Z', value: '0.4.0' },
    { sha: 'c'.repeat(40), committedAt: '2026-02-11T00:00:00Z', value: '0.5.0' },
    { sha: 'b'.repeat(40), committedAt: '2026-02-10T00:00:00Z', value: '0.5.0' },
    { sha: 'a'.repeat(40), committedAt: '2025-10-01T00:00:00Z', value: '0.4.0' },
  ];
  const provider = {
    listCommitsForPath: async () =>
      ok(commits.map(({ sha, committedAt }) => ({ sha, committedAt }))),
    getFile: async (_r: string, _p: string, ref?: string) => {
      const c = commits.find((x) => x.sha === ref);
      return c
        ? ok({ text: `# env\numbrella: ${c.value}\nother: 1\n` })
        : fail({ classification: 'not-found' as const });
    },
    getCommitDate: async (_r: string, ref: string) =>
      ref === 'v0.5.0'
        ? ok('2026-02-09T00:00:00Z')
        : ref === 'v0.5.1'
          ? ok('2026-02-14T00:00:00Z')
          : fail({ classification: 'not-found' as const }),
  } as unknown as SourceProvider;

  it('promotion, formatting-only commit, rollback, non-semver value', async () => {
    const p = withEnv(await baseProject(), {
      type: 'versions-file',
      repository: 'coordinator',
      path: 'environments/prod.yaml',
      key: 'umbrella',
      tagPrefix: 'v',
    });
    const r = await collectDeploySignal(
      provider,
      { config: p, workflows: [] },
      p.environments[0]!,
      now,
      windows,
    );
    expect(r.reason).toBeNull();
    expect(r.events.map((e) => [e.kind, e.version])).toEqual([
      ['deploy', '0.5.0'],
      ['rollback', '0.4.0'],
      ['deploy', '0.5.1'],
    ]);
    expect(r.notes).toEqual([`non-semver value at ${'f'.repeat(7)}`]);
    expect(r.events[0]?.leadHours).toBe(24);
    const m = deliveryMetrics(r.events, 'versions-file', windows, now);
    expect(m.cfrPercent).toBe(50);
  });

  it('an unreadable repository is not called again', async () => {
    const p = withEnv(await baseProject(), {
      type: 'versions-file',
      repository: 'coordinator',
      path: 'environments/prod.yaml',
      key: 'umbrella',
      tagPrefix: 'v',
    });
    let calls = 0;
    const counting = {
      listCommitsForPath: async () => {
        calls++;
        return ok([]);
      },
    } as unknown as SourceProvider;
    const r = await collectDeploySignal(
      counting,
      {
        config: p,
        workflows: [],
        repos: [
          {
            repository: p.coordinator.repository,
            repo: fail({ classification: 'not-found' as const }),
          },
        ],
      },
      p.environments[0]!,
      now,
      windows,
    );
    expect(calls).toBe(0);
    expect(r).toMatchObject({ reason: 'source-unreadable', error: null });
  });

  it('an unreadable commit history is not visible', async () => {
    const p = withEnv(await baseProject(), {
      type: 'versions-file',
      repository: 'coordinator',
      path: 'environments/prod.yaml',
      key: 'umbrella',
      tagPrefix: 'v',
    });
    const denied = {
      listCommitsForPath: async () =>
        fail({ classification: 'not-authorised' as const, httpStatus: 403 }),
    } as unknown as SourceProvider;
    const r = await collectDeploySignal(
      denied,
      { config: p, workflows: [] },
      p.environments[0]!,
      now,
      windows,
    );
    expect(r).toMatchObject({ events: [], reason: 'needs-permission' });
    expect(r.error).toMatchObject({ classification: 'not-authorised' });
  });
});

describe('workflow signal', () => {
  const run = (
    id: number,
    conclusion: string,
    createdAt: string,
    updatedAt: string,
  ): WorkflowRunDTO => ({
    id,
    runNumber: id,
    runAttempt: 1,
    status: 'completed',
    conclusion,
    headBranch: 'main',
    event: 'push',
    headSha: null,
    headCommitAt: '2026-02-20T00:00:00Z',
    createdAt,
    updatedAt,
    htmlUrl: `https://github.com/o/a/actions/runs/${id}`,
  });

  it('success, failure, success 2 h later', async () => {
    const base = await baseProject();
    const workflow = base.trackedWorkflows[0]!;
    const p = withEnv(base, { type: 'workflow', workflow: workflow.id });
    const runs = [
      run(3, 'success', '2026-02-21T10:00:00Z', '2026-02-21T10:00:00Z'),
      run(2, 'failure', '2026-02-21T08:00:00Z', '2026-02-21T08:00:00Z'),
      run(1, 'success', '2026-02-20T08:00:00Z', '2026-02-20T08:00:00Z'),
      {
        ...run(0, '', '2026-02-22T00:00:00Z', '2026-02-22T00:00:00Z'),
        status: 'in_progress',
        conclusion: null,
      },
    ];
    const r = await collectDeploySignal(
      {} as SourceProvider,
      { config: p, workflows: [{ workflow, runs: ok(runs) }] },
      p.environments[0]!,
      now,
      windows,
    );
    expect(r.events.map((e) => e.kind)).toEqual(['deploy', 'failure', 'deploy']);
    expect(r.events[0]?.leadHours).toBe(8);
    const m = deliveryMetrics(r.events, 'workflow', windows, now);
    expect(m).toMatchObject({ cfrPercent: 33.3, ttrHoursMedian: 2 });
  });
});

describe('external signal and the evaluator', () => {
  it('external: no events, delivery cells not visible with the environment name', async () => {
    const p = withEnv(await baseProject(), { type: 'external' });
    const r = await collectDeploySignal(
      {} as SourceProvider,
      { config: p, workflows: [] },
      p.environments[0]!,
      now,
      windows,
    );
    expect(r).toMatchObject({ events: [], reason: 'external-pipelines', signal: 'external' });
    const snapshot = ProjectSnapshotSchema.parse(
      JSON.parse(readFileSync('fixtures/snapshots/projects/project-alpha.json', 'utf8')),
    );
    const map = evaluateControlMap(
      {
        snapshot,
        project: p,
        extras: {
          ...emptyExtras(),
          deploy: {
            environment: 'PROD',
            signal: 'external',
            reason: 'external-pipelines',
            frequencyPerWeek: null,
            leadHoursMedian: null,
            cfrPercent: null,
            ttrHoursMedian: null,
            notes: [],
          },
        },
      },
      policies,
    );
    for (const id of ['deploy-frequency', 'lead-time', 'change-failure-rate', 'time-to-restore'])
      expect(map.cells.find((c) => c.check === id)).toMatchObject({
        level: null,
        state: 'not-visible',
        reason: 'external-pipelines',
        environment: 'PROD',
      });
  });

  it('no environments: delivery checks are n/a', async () => {
    const p = { ...(await baseProject()), environments: [] };
    const snapshot = ProjectSnapshotSchema.parse(
      JSON.parse(readFileSync('fixtures/snapshots/projects/project-alpha.json', 'utf8')),
    );
    const map = evaluateControlMap({ snapshot, project: p, extras: emptyExtras() }, policies);
    expect(map.cells.find((c) => c.check === 'lead-time')).toMatchObject({
      state: 'not-applicable',
      reason: 'no-object',
    });
  });

  it('lead time 24 h is level 4', async () => {
    const p = await baseProject();
    const snapshot = ProjectSnapshotSchema.parse(
      JSON.parse(readFileSync('fixtures/snapshots/projects/project-alpha.json', 'utf8')),
    );
    const map = evaluateControlMap(
      {
        snapshot,
        project: p,
        extras: {
          ...emptyExtras(),
          deploy: {
            environment: 'PROD',
            signal: 'versions-file',
            reason: null,
            frequencyPerWeek: 1,
            leadHoursMedian: 24,
            cfrPercent: 0,
            ttrHoursMedian: null,
            notes: [],
          },
        },
      },
      policies,
    );
    expect(map.cells.find((c) => c.check === 'lead-time')).toMatchObject({
      level: 4,
      signal: 'versions-file',
    });
    expect(map.cells.find((c) => c.check === 'time-to-restore')).toMatchObject({
      level: null,
      reason: 'insufficient-events',
    });
  });
});
