import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSitePolicies } from '../../src/lib/policies';

/*
 * The "How to read" page renders weights, caps and thresholds from the parsed policies,
 * never from hard-coded numbers. POLICIES_FILE points the site build at the policies of a
 * separate configuration (deploy repository). Only a missing default file falls back to the
 * schema defaults; an explicit POLICIES_FILE that cannot be read, or any invalid file, fails
 * the build instead of explaining policies nobody configured.
 */
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eph-policies-'));
});
afterEach(async () => {
  delete process.env.POLICIES_FILE;
  vi.restoreAllMocks();
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
      quality: 10,
    });
    expect(policies.score.caps).toEqual({ red: 49, amber: 89, grey: 89 });
    expect(policies.score.minMeasuredRatio).toBe(0.5);
    expect(policies.freshness.workflowRunStaleDays).toBe(14);
  });

  it('exposes the history retention defaults (120, 90) when the file omits the block', async () => {
    const file = join(dir, 'policies.yaml');
    await writeFile(file, minimal());
    process.env.POLICIES_FILE = file;
    expect(loadSitePolicies().policies.history).toEqual({
      enabled: true,
      maxEntries: 120,
      maxAgeDays: 90,
    });
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

  it('falls back to the schema defaults only when the default file is missing', () => {
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const missing = loadSitePolicies();
    expect(missing.source).toBe('defaults');
    expect(missing.policies.score.weights.security).toBe(30);
    expect(missing.policies.freshness.securityScanStaleDays).toBe(7);
  });

  it('fails when an explicit POLICIES_FILE cannot be read', () => {
    process.env.POLICIES_FILE = join(dir, 'missing.yaml');
    expect(() => loadSitePolicies()).toThrow(/not readable/);
  });

  it('fails when the policies file is invalid', async () => {
    const bad = join(dir, 'bad.yaml');
    await writeFile(bad, minimal('score: { bonus: 1 }'));
    process.env.POLICIES_FILE = bad;
    expect(() => loadSitePolicies()).toThrow(/Invalid policies/);

    const broken = join(dir, 'broken.yaml');
    await writeFile(broken, 'schemaVersion: [unclosed');
    process.env.POLICIES_FILE = broken;
    expect(() => loadSitePolicies()).toThrow(/not valid YAML/);
  });

  it('fails when the default file exists but is invalid', async () => {
    await mkdir(join(dir, 'config'));
    await writeFile(join(dir, 'config', 'policies.yaml'), minimal('score: { bonus: 1 }'));
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    expect(() => loadSitePolicies()).toThrow(/Invalid policies/);
  });
});
