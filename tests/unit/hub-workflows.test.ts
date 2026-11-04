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
