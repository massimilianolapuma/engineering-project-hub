import { describe, expect, it } from 'vitest';
import {
  codeScanningSeverity,
  normaliseSeverity,
  normaliseStatus,
} from '../../collector/src/normalizers/security';
import { QualitySummarySchema } from '@model/index';
import { ok } from '../../collector/src/providers/types';
import { countOpen, toFindings } from '../../collector/src/normalizers/security-model';
import type { BuildContext } from '../../collector/src/normalizers/model';
import { NOW, policies, repoData, repoDto } from '../helpers/factories';
import { compareVersions, normaliseVersion } from '../../collector/src/util/semver';
import { githubRepositoryFromUrl, parseGitmodules } from '../../collector/src/util/gitmodules';

describe('severity normalisation', () => {
  it.each([
    ['critical', 'critical'],
    ['HIGH', 'high'],
    ['error', 'high'],
    ['moderate', 'medium'],
    ['medium', 'medium'],
    ['warning', 'medium'],
    ['low', 'low'],
    ['note', 'informational'],
    ['', 'unknown'],
    ['banana', 'unknown'],
  ])('%s → %s', (raw, expected) => expect(normaliseSeverity(raw)).toBe(expected));

  it('prefers code scanning security severity and keeps the original value', () => {
    expect(codeScanningSeverity('critical', 'error')).toEqual({
      severity: 'critical',
      original: 'critical',
    });
    expect(codeScanningSeverity(null, 'warning')).toEqual({
      severity: 'medium',
      original: 'warning',
    });
  });
});

describe('status normalisation', () => {
  it.each([
    ['open', null, 'open'],
    ['fixed', null, 'fixed'],
    ['dismissed', 'false positive', 'false-positive'],
    ['dismissed', "won't fix", 'accepted-risk'],
    ['dismissed', 'tolerable_risk', 'accepted-risk'],
    ['dismissed', 'inaccurate', 'false-positive'],
    ['dismissed', 'fix_started', 'dismissed'],
    ['auto_dismissed', null, 'dismissed'],
    ['resolved', 'revoked', 'fixed'],
    ['resolved', 'false_positive', 'false-positive'],
    ['resolved', 'wont_fix', 'accepted-risk'],
    ['weird', null, 'unknown'],
  ])('%s/%s → %s', (state, reason, expected) =>
    expect(normaliseStatus(state, reason)).toBe(expected),
  );
});

describe('versions', () => {
  it('normalises prefixes and leading v', () => {
    expect(normaliseVersion('v1.2.3')).toBe('1.2.3');
    expect(normaliseVersion('backend-v2.0.0', 'backend-')).toBe('2.0.0');
    expect(normaliseVersion(null)).toBeNull();
  });
  it('compares semver and refuses to order non-semver', () => {
    expect(compareVersions('1.3.0', '1.4.0')).toBe(-1);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('2.0.0', '2.0.0-rc.1')).toBe(1);
    expect(compareVersions('release-a', 'release-b')).toBeNull();
    expect(compareVersions('release-a', 'release-a')).toBe(0);
  });
});

describe('.gitmodules parsing', () => {
  const text = `
# comment
[submodule "backend"]
\tpath = services/backend
\turl = https://github.com/example-org/backend.git
[submodule "web"]
\tpath = ./apps/web/
\turl = ../web.git
\tbranch = main
[submodule "broken"]
\turl = https://example.invalid/x.git
[core]
\tbare = false
`;
  it('extracts path, url and branch; skips entries without path', () => {
    expect(parseGitmodules(text)).toEqual([
      {
        name: 'backend',
        path: 'services/backend',
        url: 'https://github.com/example-org/backend.git',
        branch: null,
      },
      { name: 'web', path: 'apps/web', url: '../web.git', branch: 'main' },
    ]);
  });
  it('maps GitHub remotes to owner/name and ignores other hosts', () => {
    expect(githubRepositoryFromUrl('https://github.com/Example-Org/Backend.git', 'x/y')).toBe(
      'example-org/backend',
    );
    expect(githubRepositoryFromUrl('git@github.com:example-org/api.git', 'x/y')).toBe(
      'example-org/api',
    );
    expect(githubRepositoryFromUrl('../web.git', 'example-org/coordinator')).toBe(
      'example-org/web',
    );
    expect(githubRepositoryFromUrl('https://gitlab.example/x/y.git', 'x/y')).toBeNull();
  });
});

describe('workflow run selection', async () => {
  const { branchRuns, lastCompletedRun } = await import('../../collector/src/collectors/collect');
  const run = (n: number, event: string, conclusion: string | null, status = 'completed') => ({
    id: n,
    runNumber: n,
    runAttempt: 1,
    status,
    conclusion,
    headBranch: 'main',
    event,
    headSha: null,
    createdAt: new Date(Date.UTC(2026, 0, n)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, n)).toISOString(),
    htmlUrl: 'https://github.com/o/r/actions/runs/1',
  });
  it('ignores pull-request runs (fork PRs report head_branch main) and non-informative conclusions', () => {
    const runs = [
      run(5, 'pull_request', 'action_required'),
      run(4, 'pull_request', 'failure'),
      run(3, 'push', 'skipped'),
      run(2, 'push', 'success'),
      run(1, 'push', 'failure'),
    ];
    const branch = branchRuns(runs);
    expect(branch.map((r) => r.runNumber)).toEqual([3, 2, 1]);
    expect(lastCompletedRun(branch)?.runNumber).toBe(2);
  });
});

describe('QualitySummarySchema', () => {
  const valid = {
    schemaVersion: '1.0',
    repository: 'example-org/demo',
    ref: 'refs/heads/main',
    commitSha: 'a'.repeat(40),
    generatedAt: '2026-01-15T12:00:00Z',
    tool: 'cobertura',
    format: 'cobertura',
    lines: { covered: 80, valid: 100 },
  };
  it('accepts a valid summary', () =>
    expect(QualitySummarySchema.safeParse(valid).success).toBe(true));
  it('QualitySummarySchema rejects extra keys', () => {
    expect(QualitySummarySchema.safeParse({ ...valid, files: ['a.ts'] }).success).toBe(false);
    expect(
      QualitySummarySchema.safeParse({ ...valid, lines: { ...valid.lines, branches: 1 } }).success,
    ).toBe(false);
  });
  it('rejects covered > valid', () =>
    expect(
      QualitySummarySchema.safeParse({ ...valid, lines: { covered: 11, valid: 10 } }).success,
    ).toBe(false));
  it('rejects non-hex commitSha', () =>
    expect(QualitySummarySchema.safeParse({ ...valid, commitSha: 'z'.repeat(40) }).success).toBe(
      false,
    ));
});

describe('security findings: match keys and exceptions', () => {
  const ctx: BuildContext = { projectId: 'beta', policies: policies(), now: NOW, errors: [] };
  const alert = {
    number: 7,
    state: 'open',
    dismissedReason: null,
    ruleId: 'py/flask-debug',
    ruleSeverity: 'warning',
    securitySeverityLevel: 'medium',
    ruleDescription: 'Flask app is run in debug mode',
    toolName: 'CodeQL',
    createdAt: '2026-01-10T12:00:00.000Z',
    updatedAt: '2026-01-10T12:00:00.000Z',
    htmlUrl: 'https://github.com/example-org/project-beta-api/security/code-scanning/7',
  };

  it('toFindings keeps keys.ruleId "py/flask-debug" while finding.ruleId is null for a private repo under public audience', () => {
    const data = repoData('project-beta-api', {
      repo: ok(repoDto('project-beta-api', 'private')),
      codeScanning: ok([alert]),
    });
    const { findings } = toFindings(ctx, data);
    expect(findings[0]!.keys).toMatchObject({ alert: 7, ruleId: 'py/flask-debug', tool: 'CodeQL' });
    expect(findings[0]!.finding.ruleId).toBeNull();
    expect(findings[0]!.finding.title).toBeNull();
    expect(JSON.stringify(findings[0]!.finding)).not.toContain('py/flask-debug');
  });

  it('keeps the advisory ids as match keys (GHSA and CVE) for Dependabot', () => {
    const data = repoData('project-beta-api', {
      repo: ok(repoDto('project-beta-api', 'private')),
      dependabot: ok([
        {
          number: 4,
          state: 'open',
          dismissedReason: null,
          ghsaId: 'GHSA-demo-0004-mono',
          cveId: 'CVE-2025-12345',
          severity: 'low',
          summary: 's',
          packageName: 'p',
          firstPatchedVersion: null,
          createdAt: null,
          updatedAt: null,
          htmlUrl: 'https://github.com/example-org/project-beta-api/security/dependabot/4',
        },
      ]),
    });
    const { findings } = toFindings(ctx, data);
    expect(findings[0]!.keys.advisoryIds).toEqual(['GHSA-demo-0004-mono', 'CVE-2025-12345']);
    expect(findings[0]!.finding.ruleId).toBeNull();
  });

  it('countOpen ignores findings with exception.state active', () => {
    const data = repoData('project-beta-api', { codeScanning: ok([alert]) });
    const [f] = toFindings(ctx, data).findings.map((m) => m.finding);
    const accepted = {
      ...f!,
      exception: { id: 'EXC-1', state: 'active' as const, expires: '2026-02-04' },
    };
    const expired = {
      ...accepted,
      exception: { ...accepted.exception, state: 'expired' as const },
    };
    expect(countOpen([{ ...f!, exception: null }]).medium).toBe(1);
    expect(countOpen([accepted]).medium).toBe(0);
    expect(countOpen([expired]).medium).toBe(1);
  });
});
