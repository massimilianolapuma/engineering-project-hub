import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPolicyCheck } from '../../collector/src/policy/check';

const NOW = new Date('2026-01-15T12:00:00.000Z');

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'policy-check-'));
}

/** A writable copy of the repository config directory. */
function configCopy(): string {
  const dir = join(tempDir(), 'config');
  cpSync('config', dir, { recursive: true });
  return dir;
}

const run = (over: Partial<Parameters<typeof runPolicyCheck>[0]> = {}) =>
  runPolicyCheck({ configDir: 'config', now: NOW, ...over });

const EXCEPTION = (over: Record<string, string> = {}) => {
  const e = {
    id: 'EXC-T-001',
    repository: 'example-org/platform-mono',
    created: "'2026-01-01'",
    expires: "'2026-03-01'",
    ...over,
  };
  return `schemaVersion: '1.0'
exceptions:
  - id: ${e.id}
    repository: ${e.repository}
    source: code-scanning
    match: { alert: 2 }
    owner: team-platform
    reason: Accepted for the unit test only.
    created: ${e.created}
    expires: ${e.expires}
`;
};

describe('policy:check with the repository config', () => {
  it('passes at the golden clock and ends with the summary line', async () => {
    const r = await run();
    expect(r.exitCode).toBe(0);
    expect(r.lines.at(-1)).toBe('Summary: 8 passed, 0 failed, 0 warning(s)');
    expect(r.lines).toContain('✔ config/policies.yaml: schema 1.0');
    expect(r.lines).toContain('✔ config/exceptions.yaml: 0 exception(s)');
  });

  it('explains an escalating overdue high alert with the policy key', async () => {
    const r = await run();
    const text = r.lines.join('\n');
    expect(text).toContain('red   sla-overdue');
    expect(text).toContain('← remediation.overdue.high');
    expect(text).toMatch(/✔ .* — Security red/);
    expect(text).toMatch(/✔ .* — Overall red/);
  });
});

describe('policy:check decision cases and validation', () => {
  it('fails a case whose expectation is wrong', async () => {
    const config = configCopy();
    const file = join(config, 'policy-cases', 'high-within-sla.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('status: amber', 'status: green'));
    const r = await run({ configDir: config });
    expect(r.exitCode).toBe(1);
    expect(r.lines.some((l) => /^✖ .* — expected green, got amber$/.test(l))).toBe(true);
    expect(r.lines.at(-1)).toBe('Summary: 7 passed, 1 failed, 0 warning(s)');
  });

  it('fails an exception whose span exceeds exceptions.maxDays', async () => {
    const config = configCopy();
    writeFileSync(
      join(config, 'exceptions.yaml'),
      EXCEPTION({ created: "'2026-01-01'", expires: "'2026-07-01'" }),
    );
    const r = await run({ configDir: config });
    expect(r.exitCode).toBe(1);
    expect(r.lines.some((l) => l.includes('exceeds exceptions.maxDays (180)'))).toBe(true);
    expect(r.lines.some((l) => l.startsWith('✖ ') && l.includes('exceptions[0] (EXC-T-001)'))).toBe(
      true,
    );
  });

  it('fails an exception created in the future', async () => {
    const config = configCopy();
    writeFileSync(
      join(config, 'exceptions.yaml'),
      EXCEPTION({ created: "'2026-01-16'", expires: "'2026-02-10'" }),
    );
    const r = await run({ configDir: config });
    expect(r.exitCode).toBe(1);
    expect(
      r.lines.some((l) => l.startsWith('✖ ') && l.includes('created in the future (2026-01-16)')),
    ).toBe(true);
  });

  it('reports a schema error with its path', async () => {
    const config = configCopy();
    writeFileSync(join(config, 'exceptions.yaml'), EXCEPTION().replace('team-platform', 'a b c d'));
    const r = await run({ configDir: config });
    expect(r.exitCode).toBe(1);
    expect(r.lines.some((l) => l.startsWith('✖ ') && l.includes('exceptions[0].owner'))).toBe(true);
  });

  it('treats an expiring-soon entry as a warning, failing only with failOnWarnings', async () => {
    const config = configCopy();
    writeFileSync(
      join(config, 'exceptions.yaml'),
      EXCEPTION({ created: "'2026-01-01'", expires: "'2026-01-20'" }),
    );
    const ok = await run({ configDir: config });
    expect(ok.exitCode).toBe(0);
    expect(ok.lines.some((l) => l.startsWith('⚠ ') && l.includes('expires in'))).toBe(true);
    expect(ok.lines.at(-1)).toBe('Summary: 8 passed, 0 failed, 1 warning(s)');
    const strict = await run({ configDir: config, failOnWarnings: true });
    expect(strict.exitCode).toBe(1);
  });

  it('warns "no decision cases" when the cases directory is missing', async () => {
    const config = configCopy();
    const r = await run({ configDir: config, casesDir: join(config, 'does-not-exist') });
    expect(r.exitCode).toBe(0);
    expect(r.lines.some((l) => l.startsWith('⚠ ') && l.includes('no decision cases'))).toBe(true);
  });

  it('exits 2 when the config directory has no policies', async () => {
    const r = await run({ configDir: tempDir() });
    expect(r.exitCode).toBe(2);
  });
});

describe('policy:check decision case readability', () => {
  it('an unreadable pair written in another letter case still makes the exception unverifiable', async () => {
    const dir = join(tempDir(), 'cases');
    cpSync('config/policy-cases', dir, { recursive: true });
    const file = join(dir, 'unverifiable-exception.yaml');
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(
        'example-org/project-beta-web|secret-scanning',
        'Example-Org/Project-Beta-Web|secret-scanning',
      ),
    );
    const r = await run({ casesDir: dir });
    expect(r.exitCode).toBe(0);
    expect(r.lines.join('\n')).toContain('security-exception-unverifiable');
  });
});

describe('policy:check --snapshot (read-only what-if)', () => {
  const base = {
    snapshotDir: 'fixtures/snapshots',
    exceptionsFile: 'fixtures/exceptions/exceptions.yaml',
    allowDateTokens: true,
  };

  it('finds the golden snapshot unchanged and reports withheld exceptions', async () => {
    const r = await run(base);
    expect(r.exitCode).toBe(0);
    expect(r.lines).toContain('unchanged: platform');
    expect(r.lines).toContain('unchanged: project-alpha');
    expect(r.lines).toContain('unchanged: project-gamma');
    expect(
      r.lines.some((l) =>
        l.includes('not evaluable from this snapshot (details withheld): EXC-BETA-001'),
      ),
    ).toBe(true);
    // The withheld rule and the reason marker never reach the output.
    const text = r.lines.join('\n');
    expect(text).not.toContain('py/flask-debug');
    expect(text).not.toContain('marker-reason-b7c1');
  });

  it('shows what a softer policy would change', async () => {
    const config = configCopy();
    const file = join(config, 'policies.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('    high: red #', '    high: info #'));
    const r = await run({ ...base, configDir: config });
    const text = r.lines.join('\n');
    expect(text).toContain('would change: platform security red → amber');
    expect(text).toContain('overall red → amber');
  });

  it('writes nothing', async () => {
    const root = tempDir();
    const snap = join(root, 'snapshots');
    cpSync('fixtures/snapshots', snap, { recursive: true });
    const list = (dir: string): string[] =>
      readdirSync(dir, { recursive: true, withFileTypes: false })
        .map(String)
        .sort()
        .map((p) => {
          const s = statSync(join(dir, p));
          return `${p}|${s.size}|${s.mtimeMs}`;
        });
    const before = list(root);
    const r = await run({ ...base, snapshotDir: snap });
    expect(r.exitCode).toBe(0);
    expect(list(root)).toEqual(before);
  });

  it('rejects an unsupported snapshot schemaVersion', async () => {
    const snap = join(tempDir(), 'snapshots');
    cpSync('fixtures/snapshots', snap, { recursive: true });
    const index = join(snap, 'index.json');
    writeFileSync(
      index,
      readFileSync(index, 'utf8').replace(/"schemaVersion": "1\.6"/, '"schemaVersion": "1.4"'),
    );
    const r = await run({ ...base, snapshotDir: snap });
    expect(r.exitCode).toBe(1);
    expect(r.lines.some((l) => l.includes('unsupported snapshot schemaVersion'))).toBe(true);
  });
});

describe('scripts/policy-check.ts', () => {
  it('exits 2 on an unknown flag', () => {
    const r = spawnSync('npx', ['tsx', 'scripts/policy-check.ts', '--definitely-unknown'], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
  });
});
