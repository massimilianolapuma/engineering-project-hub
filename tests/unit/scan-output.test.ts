import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_SCAN_BYTES, scan } from '../../scripts/scan-output';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eph-scan-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('scan-output (publication gate)', () => {
  it('reports credential patterns by name, never by value', async () => {
    await writeFile(join(dir, 'page.html'), '<p>ghp_exampleSecretValue</p>');
    const { findings } = await scan([dir]);
    expect(findings).toEqual([`${join(dir, 'page.html')}: github-token`]);
    expect(findings.join()).not.toContain('ghp_exampleSecretValue');
  });

  it('fails closed on files too large to scan instead of skipping them', async () => {
    const big = join(dir, 'big.json');
    await writeFile(big, Buffer.alloc(MAX_SCAN_BYTES + 1, 'a'));
    const { findings } = await scan([dir]);
    expect(findings).toContain(`${big}: too large to scan (> ${MAX_SCAN_BYTES} bytes)`);
  });

  it('flags forbidden file types', async () => {
    await writeFile(join(dir, '.env'), 'X=1');
    const { findings } = await scan([dir]);
    expect(findings.some((f) => f.endsWith('.env: forbidden file type'))).toBe(true);
  });
});
