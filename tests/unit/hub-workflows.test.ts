import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/*
 * Structural checks on the hub's own workflows: which job holds which secret and token, and the
 * history persistence of the protected (real-data) deploy path.
 */
type Step = {
  name?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  if?: string;
};
type Job = {
  permissions?: Record<string, string>;
  steps?: Step[];
  needs?: string | string[];
  if?: string;
  uses?: string;
  secrets?: Record<string, string>;
  with?: Record<string, unknown>;
};
const workflow = (file: string) =>
  parse(readFileSync(`.github/workflows/${file}`, 'utf8')) as {
    jobs: Record<string, Job>;
    on: unknown;
    permissions?: unknown;
  };

describe('rw-hub-cloudflare-deploy.yml keeps history', () => {
  const wf = workflow('rw-hub-cloudflare-deploy.yml');
  const collect = wf.jobs.collect!;
  const steps = collect.steps ?? [];

  it('lets the collect job read its own artifacts', () => {
    expect(collect.permissions?.actions).toBe('read');
  });

  it('restores the previous history with the workflow token only', () => {
    const restore = steps.find((s) => s.run?.includes('history:restore'));
    expect(restore).toBeDefined();
    expect(Object.keys(restore!.env ?? {})).toEqual(['GITHUB_TOKEN']);
  });

  it('passes the restored history to the collector', () => {
    const run = steps.find((s) => s.run?.includes('collector/src/index.ts'));
    expect(run?.env).toHaveProperty('HISTORY_FROM');
    expect(run?.env).toHaveProperty('HISTORY_RESTORE_STATE');
  });

  it('uploads hub-history for 90 days', () => {
    const up = steps.find((s) => s.with?.name === 'hub-history');
    expect(up?.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}/);
    expect(up?.with?.['retention-days']).toBe(90);
  });
});

const SOURCE_SECRETS = [
  'GH_APP_ID',
  'GH_APP_PRIVATE_KEY',
  'GH_APP_INSTALLATION_ID',
  'GH_READ_TOKEN',
  'SONARQUBE_TOKEN',
  'HARBOR_ROBOT_NAME',
  'HARBOR_ROBOT_SECRET',
  'ARGOCD_TOKEN',
];
const text = (x: unknown) => JSON.stringify(x ?? null);

/** Shared checks for a notify job's steps (notify.yml, or the protected path's inline job). */
function checkNotifySteps(steps: Step[]) {
  const withSecret = steps.filter((s) => text(s).includes('TEAMS_WEBHOOK_URL'));
  expect(withSecret.map((s) => s.name)).toEqual(['Notify']);
  const notify = withSecret[0]!;
  expect(notify.env?.TEAMS_WEBHOOK_URL).toBe('${{ secrets.TEAMS_WEBHOOK_URL }}');
  expect(notify.run ?? '').not.toContain('${{');
  expect(Object.keys(notify.env ?? {})).toEqual(
    expect.arrayContaining(['HUB_NOTIFICATIONS', 'DATA_SOURCE', 'HUB_LEDGER_STATE']),
  );
  for (const s of steps) for (const name of SOURCE_SECRETS) expect(text(s)).not.toContain(name);
  const restore = steps.find((s) => s.run?.includes('notify:restore-ledger'));
  expect(Object.keys(restore?.env ?? {})).toEqual(['GITHUB_TOKEN']);
  expect(restore?.if).toContain("== 'send'");
  // A crashed restore in send mode counts as failed: nothing is sent.
  expect(notify.env?.HUB_LEDGER_STATE).toContain("'failed'");
  const ledger = steps.find((s) => s.with?.name === 'hub-notify-ledger');
  expect(ledger?.with?.['retention-days']).toBe(90);
  expect(ledger?.with?.overwrite).toBe(true);
  // Only a ledger this run saved is uploaded: a bad restored one is never re-published.
  expect(ledger?.if).toContain("steps.notify.outputs.ledger == 'saved'");
  expect(steps.some((s) => s.run?.includes('scan:output'))).toBe(true);
}

describe('notify.yml (reusable, GitHub Pages path)', () => {
  const wf = workflow('notify.yml');
  const job = wf.jobs.notify!;

  it('has no workflow permissions and only contents/actions read on the job', () => {
    expect(wf.permissions).toEqual({});
    expect(job.permissions).toEqual({ contents: 'read', actions: 'read' });
    expect((job as Job & { concurrency?: unknown }).concurrency).toEqual({
      group: 'hub-notify',
      'cancel-in-progress': false,
    });
  });

  it('keeps the Teams secret in the Notify step only', () => checkNotifySteps(job.steps ?? []));
});

describe('deploy-pages.yml', () => {
  const wf = workflow('deploy-pages.yml');

  it('runs notify after deploy, opt-in, with the Teams secret only', () => {
    const notify = wf.jobs.notify!;
    expect(notify.needs).toEqual(['collect', 'deploy']);
    expect(notify.if).toContain('vars.HUB_NOTIFICATIONS');
    expect(notify.uses).toBe('./.github/workflows/notify.yml');
    expect(Object.keys(notify.secrets ?? {})).toEqual(['TEAMS_WEBHOOK_URL']);
    expect(notify.permissions).toEqual({ contents: 'read', actions: 'read' });
  });

  it('no other job sees the Teams secret, and deploy never waits for notify', () => {
    for (const [name, job] of Object.entries(wf.jobs))
      if (name !== 'notify') expect(text(job), name).not.toContain('TEAMS_WEBHOOK_URL');
    expect(text(wf.jobs.deploy?.needs)).not.toContain('notify');
  });
});

describe('rw-hub-cloudflare-deploy.yml notify job', () => {
  const wf = workflow('rw-hub-cloudflare-deploy.yml');
  const on = wf.on as {
    workflow_call: {
      inputs: Record<string, { default?: string }>;
      secrets: Record<string, { required: boolean }>;
    };
  };

  it('is opt-in through the notifications input and an optional secret', () => {
    expect(on.workflow_call.inputs.notifications?.default).toBe('');
    expect(on.workflow_call.secrets.TEAMS_WEBHOOK_URL).toEqual({ required: false });
    const notify = wf.jobs.notify!;
    expect(notify.if).toContain('inputs.notifications');
    expect(notify.needs).toEqual(['verify', 'deploy']);
    expect(notify.permissions).toEqual({ contents: 'read', actions: 'read' });
  });

  it('keeps the Teams secret in the Notify step only', () => {
    checkNotifySteps(wf.jobs.notify!.steps ?? []);
    for (const [name, job] of Object.entries(wf.jobs))
      if (name !== 'notify') expect(text(job), name).not.toContain('TEAMS_WEBHOOK_URL');
  });
});
