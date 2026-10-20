import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSitePolicies } from '../../src/lib/policies';

/*
 * The "How to read" page renders weights, caps and thresholds from the parsed policies,
 * never from hard-coded numbers. POLICIES_FILE points the site build at the policies of a
 * separate configuration (deploy repository); without a readable file the schema defaults apply.
 */
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eph-policies-'));
});
afterEach(async () => {
  delete process.env.POLICIES_FILE;
  await rm(dir, { recursive: true, force: true });
});

const minimal = (extra = '') => `schemaVersion: '1.0'
freshness: { workflowRunStaleDays: 3 }
delivery: {}
security: {}
coverage: {}
version: {}
governance: {}
overall: {}
publication: {}
${extra}`;

describe('loadSitePolicies', () => {
  it('reads config/policies.yaml by default', () => {
    const { policies, source } = loadSitePolicies();
    expect(source).toBe('file');
    expect(policies.score.weights).toEqual({
      delivery: 25,
      version: 15,
      security: 30,
      coverage: 15,
      governance: 15,
    });
    expect(policies.score.caps).toEqual({ red: 49, amber: 89, grey: 89 });
    expect(policies.score.minMeasuredRatio).toBe(0.5);
    expect(policies.freshness.workflowRunStaleDays).toBe(14);
  });

  it('honours POLICIES_FILE', async () => {
    const file = join(dir, 'policies.yaml');
    await writeFile(file, minimal('score: { weights: { security: 50 }, caps: { grey: 79 } }'));
    process.env.POLICIES_FILE = file;
    const { policies, source } = loadSitePolicies();
    expect(source).toBe('file');
    expect(policies.score.weights.security).toBe(50);
    expect(policies.score.weights.delivery).toBe(25);
    expect(policies.score.caps.grey).toBe(79);
    expect(policies.freshness.workflowRunStaleDays).toBe(3);
  });

  it('falls back to the schema defaults when the file is missing or invalid', async () => {
    process.env.POLICIES_FILE = join(dir, 'missing.yaml');
    const missing = loadSitePolicies();
    expect(missing.source).toBe('defaults');
    expect(missing.policies.score.weights.security).toBe(30);
    expect(missing.policies.freshness.securityScanStaleDays).toBe(7);

    const bad = join(dir, 'bad.yaml');
    await writeFile(bad, minimal('score: { bonus: 1 }'));
    process.env.POLICIES_FILE = bad;
    expect(loadSitePolicies().source).toBe('defaults');
  });
});
