import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  id?: string;
  name?: string;
  if?: string;
  env?: Record<string, string>;
  run?: string;
  'continue-on-error'?: boolean;
  with?: Record<string, string>;
}
const wf = parse(readFileSync('.github/workflows/collect-data.yml', 'utf8')) as {
  on: { workflow_dispatch: { inputs: Record<string, { type: string; default: unknown }> } };
  jobs: { collect: { steps: Step[] } };
};
const steps = wf.jobs.collect.steps;
const step = (id: string) => steps.find((s) => s.id === id)!;
const uploadHistory = steps.find((s) => s.with?.name === 'hub-history')!;

describe('collect-data.yml history guards', () => {
  it('never lets a restore crash fail the collection', () => {
    expect(step('history')['continue-on-error']).toBe(true);
  });
  it('uploads hub-history only after a restore that succeeded or found nothing', () => {
    const cond = uploadHistory.if ?? '';
    expect(cond).toContain("steps.source.outputs.data-source == 'github'");
    expect(cond).toContain("steps.history.outputs.state == 'restored'");
    expect(cond).toContain("steps.history.outputs.state == 'none'");
    expect(cond).not.toContain("!= 'failed'");
  });
  it('has a fresh-history boolean dispatch input that defaults to false', () => {
    const input = wf.on.workflow_dispatch.inputs['fresh-history'];
    expect(input).toMatchObject({ type: 'boolean', default: false });
  });
  it('skips the restore on fresh-history and records the reason, still allowing the upload', () => {
    expect(step('history').if).toContain("steps.fresh.outputs.state != 'none'");
    expect(step('fresh').if).toContain('inputs.fresh-history == true');
    expect(uploadHistory.if).toContain("steps.fresh.outputs.state == 'none'");
    expect(step('fresh').run).toContain('reason=fresh-history');
  });
  it('maps inputs through env, never inline in a run script', () => {
    for (const s of steps) expect(s.run ?? '').not.toMatch(/\$\{\{\s*(inputs|steps|vars)\./);
  });
  it('gives the collector the fresh or restored state through env', () => {
    const env = steps.find((s) => s.name === 'Collect')!.env!;
    expect(env.HISTORY_RESTORE_STATE).toContain('steps.history.outputs.state');
    expect(env.HISTORY_RESTORE_STATE).toContain('steps.fresh.outputs.state');
  });
});
