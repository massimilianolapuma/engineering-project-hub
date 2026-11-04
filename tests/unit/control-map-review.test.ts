import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  PoliciesSchema,
  ProjectSnapshotSchema,
  type ControlCell,
  type ProjectConfig,
  type ProjectSnapshot,
} from '@model/index';
import { collectDeploySignal } from '../../collector/src/collectors/deploy-signals';
import { emptyExtras, evaluateControlMap } from '../../collector/src/evaluators/control-map';
import { workloadIdentityOf } from '../../collector/src/evaluators/control-map-sources';
import { loadConfig } from '../../collector/src/config/load';
import { parseWorkflow } from '../../collector/src/normalizers/workflow-refs';
import { ok, type SourceProvider, type WorkflowRunDTO } from '../../collector/src/providers/types';

/*
 * Final review findings (control map): unreadable or disabled sources are never "not applicable"
 * or 100%, misconfigured or truncated deploy signals are never a measured 0, job-level
 * permissions replace the workflow's.
 */
const policies = PoliciesSchema.parse(parse(readFileSync('config/policies.yaml', 'utf8')));
const snap = (id: string): ProjectSnapshot =>
  ProjectSnapshotSchema.parse(
    JSON.parse(readFileSync(`fixtures/snapshots/projects/${id}.json`, 'utf8')),
  );
const project = async (id: string): Promise<ProjectConfig> =>
  (await loadConfig('config')).catalog.projects.find((p) => p.id === id)!;
const cell = (cells: ControlCell[], id: string) => cells.find((c) => c.check === id)!;
const now = new Date('2026-03-01T00:00:00Z');
const windows = { frequencyDays: 30, trendDays: 90 };

describe('I1 workload identity over readable repositories', () => {
  it('repositories whose workflows could not be read are unknown, not "no deploying workflow"', () => {
    expect(
      workloadIdentityOf([
        { read: false, files: [] },
        { read: false, files: [] },
      ]),
    ).toEqual({
      deploying: 0,
      oidc: 0,
      readable: { k: 0, n: 2 },
    });
  });

  it('fewer than half the repositories read: not visible, never n/a', async () => {
    const map = evaluateControlMap(
      {
        snapshot: snap('platform'),
        project: await project('platform'),
        extras: {
          ...emptyExtras(),
          workloadIdentity: { deploying: 1, oidc: 1, readable: { k: 1, n: 10 } },
        },
      },
      policies,
    );
    expect(cell(map.cells, 'workload-identity')).toMatchObject({
      level: null,
      state: 'not-visible',
      reason: 'too-few-readable',
      readable: { k: 1, n: 10 },
    });
  });
});

describe('I2 disabled sources are not visible, never n/a', () => {
  it('repository controls off: branch checks not visible with a note', async () => {
    const off = PoliciesSchema.parse({
      ...parse(readFileSync('config/policies.yaml', 'utf8')),
      repositoryControls: { enabled: false },
    });
    const s = snap('platform');
    s.repositoryControls.repositories = [];
    const map = evaluateControlMap(
      { snapshot: s, project: await project('platform'), extras: emptyExtras() },
      off,
    );
    for (const id of ['branch-protection', 'required-checks', 'pipeline-integrity'])
      expect(cell(map.cells, id), id).toMatchObject({ state: 'not-visible', level: null });
  });

  it('attestations off everywhere: build provenance not visible', async () => {
    const s = snap('project-alpha');
    for (const r of s.supplyChain.repositories) r.attestations.state = 'off';
    const map = evaluateControlMap(
      { snapshot: s, project: await project('project-alpha'), extras: emptyExtras() },
      policies,
    );
    expect(cell(map.cells, 'build-provenance')).toMatchObject({ state: 'not-visible' });
  });
});

describe('I3 a misconfigured versions file is never a measured 0', () => {
  const env = (p: ProjectConfig) => ({
    ...p.environments[0]!,
    id: 'prod',
    name: 'PROD',
    deploySignal: {
      type: 'versions-file' as const,
      repository: 'coordinator',
      path: 'environments/prod.yaml',
      key: 'umbrella',
      tagPrefix: 'v',
    },
  });

  it('a path no commit touches is not visible', async () => {
    const p = await project('project-alpha');
    const e = { ...env(p), deploySignal: env(p).deploySignal };
    const provider = { listCommitsForPath: async () => ok([]) } as unknown as SourceProvider;
    const r = await collectDeploySignal(provider, { config: p, workflows: [] }, e, now, windows);
    expect(r).toMatchObject({ events: [], reason: 'source-unreadable' });
    expect(r.notes.join(' ')).toContain('no commit');
  });

  it('a key that never holds a version is not visible', async () => {
    const p = await project('project-alpha');
    const e = { ...env(p), deploySignal: env(p).deploySignal };
    const sha = 'a'.repeat(40);
    const provider = {
      listCommitsForPath: async () => ok([{ sha, committedAt: '2026-02-01T00:00:00Z' }]),
      getFile: async () => ok({ text: 'other: 1.2.3\n' }),
    } as unknown as SourceProvider;
    const r = await collectDeploySignal(provider, { config: p, workflows: [] }, e, now, windows);
    expect(r).toMatchObject({ events: [], reason: 'source-unreadable' });
  });
});

describe('I4/I5 workflow signal reads the window, tag-triggered runs included', () => {
  const run = (id: number, at: string, headBranch: string): WorkflowRunDTO => ({
    id,
    runNumber: id,
    runAttempt: 1,
    status: 'completed',
    conclusion: 'success',
    headBranch,
    event: 'push',
    headSha: null,
    headCommitAt: at,
    createdAt: at,
    updatedAt: at,
    htmlUrl: `https://github.com/o/a/actions/runs/${id}`,
  });

  it('pages the delivery workflow since the window start, without the branch filter', async () => {
    const base = await project('platform');
    const wf = base.trackedWorkflows.find((w) => w.id === 'release')!;
    const p = {
      ...base,
      environments: [
        { id: 'prod', name: 'PROD', deploySignal: { type: 'workflow' as const, workflow: wf.id } },
      ],
    };
    const calls: string[] = [];
    const runs = Array.from({ length: 60 }, (_, i) =>
      run(
        i + 1,
        new Date(Date.parse('2026-02-01T00:00:00Z') + i * 8 * 3_600_000).toISOString(),
        `v1.${i}.0`,
      ),
    );
    const provider = {
      listWorkflowRunsSince: async (repo: string, file: string, since: string) => {
        calls.push(`${repo}:${file}:${since}`);
        return ok({ runs, truncated: false });
      },
    } as unknown as SourceProvider;
    const r = await collectDeploySignal(
      provider,
      { config: p, workflows: [] },
      p.environments[0]!,
      now,
      windows,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`:${wf.file}:2025-12-01T00:00:00.000Z`);
    expect(r.events).toHaveLength(60);
  });

  it('a truncated list says the frequency is a lower bound', async () => {
    const base = await project('platform');
    const wf = base.trackedWorkflows.find((w) => w.id === 'release')!;
    const p = {
      ...base,
      environments: [
        { id: 'prod', name: 'PROD', deploySignal: { type: 'workflow' as const, workflow: wf.id } },
      ],
    };
    const provider = {
      listWorkflowRunsSince: async () =>
        ok({ runs: [run(1, '2026-02-20T00:00:00Z', 'main')], truncated: true }),
    } as unknown as SourceProvider;
    const r = await collectDeploySignal(
      provider,
      { config: p, workflows: [] },
      p.environments[0]!,
      now,
      windows,
    );
    expect(r.notes.join(' ')).toContain('at least');
  });
});

describe('I6 evidence freshness counts unreadable sources', () => {
  it('one fresh source out of ten (nine unreadable) is not visible, not 100%', async () => {
    const s = snap('platform');
    const proto = s.securityControls[0]!;
    s.securityControls = Array.from({ length: 10 }, (_, i) => ({
      ...proto,
      repository: `o/r${i}`,
      controls: proto.controls.map((c) => ({
        ...c,
        state: i === 0 ? 'enabled' : 'not-authorised',
      })),
    }));
    s.qualityHealth.perComponent = [];
    s.supplyChain.repositories = [];
    s.workflows = [];
    const map = evaluateControlMap(
      { snapshot: s, project: await project('platform'), extras: emptyExtras() },
      policies,
    );
    expect(cell(map.cells, 'evidence-freshness')).toMatchObject({
      state: 'not-visible',
      reason: 'too-few-readable',
    });
  });
});

describe('I7 job-level permissions replace the workflow permissions', () => {
  it('workflow id-token: write but the deploying job sets its own permissions: not OIDC', () => {
    const f = parseWorkflow(
      'deploy.yml',
      `
permissions:
  id-token: write
jobs:
  deploy:
    permissions:
      contents: read
    steps:
      - uses: azure/login@v2
        with:
          client-id: x
`,
    );
    expect(f.identity).toEqual({ deploying: true, oidc: false });
  });
});
