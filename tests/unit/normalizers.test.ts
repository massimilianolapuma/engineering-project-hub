import { describe, expect, it } from 'vitest';
import {
  codeScanningSeverity,
  normaliseSeverity,
  normaliseStatus,
} from '../../collector/src/normalizers/security';
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
