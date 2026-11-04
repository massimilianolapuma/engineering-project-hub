import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * scripts/restore-ledger.ts (notify job): always exits 0 and reports a state; never prints the
 * token. The restore logic itself is tested through restoreArtifactFile (restore-history tests).
 */
describe('restore-ledger CLI', () => {
  it('reports failed without a reachable API, exits 0, prints no token', () => {
    const token = 'ghp_exampleSecretValue123456789012345678';
    const dir = mkdtempSync(join(tmpdir(), 'rl-cli-'));
    try {
      const ghOut = join(dir, 'gh-output');
      writeFileSync(ghOut, '');
      const r = spawnSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/restore-ledger.ts', '--out', join(dir, 'out')],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            GITHUB_TOKEN: token,
            GITHUB_REPOSITORY: 'o/r',
            GITHUB_RUN_ID: '999',
            GITHUB_API_URL: 'http://127.0.0.1:1',
            GITHUB_OUTPUT: ghOut,
          },
          timeout: 60_000,
        },
      );
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Ledger restore: failed (api-error)');
      expect(r.stdout + r.stderr + readFileSync(ghOut, 'utf8')).not.toContain(token);
      expect(readFileSync(ghOut, 'utf8')).toContain('state=failed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports failed when the environment is incomplete', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/restore-ledger.ts'], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_TOKEN: '', GITHUB_OUTPUT: '' },
      timeout: 60_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Ledger restore: failed (api-error)');
  });
});
