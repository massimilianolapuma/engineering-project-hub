import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyGitHubError } from '../../collector/src/providers/github/errors';
import {
  createGitHubClient,
  GitHubProvider,
} from '../../collector/src/providers/github/github-provider';
import { makeZip, NOW, policies } from '../helpers/factories';
import { toolCandidate } from '../../collector/src/normalizers/control-sources';
import { AuthConfigError, resolveAuth } from '../../collector/src/providers/auth';
import { MockProvider } from '../../collector/src/providers/mock/mock-provider';

const httpError = (status: number, message: string, headers: Record<string, string> = {}) => ({
  status,
  message: `${message} - https://docs.github.com/rest`,
  response: { headers, data: { message } },
});

describe('GitHub error classification', () => {
  it('403 with exhausted rate limit → rate-limited', () => {
    expect(
      classifyGitHubError(
        httpError(403, 'API rate limit exceeded', { 'x-ratelimit-remaining': '0' }),
      ).classification,
    ).toBe('rate-limited');
  });
  it('429 → rate-limited', () =>
    expect(classifyGitHubError(httpError(429, 'Too many requests')).classification).toBe(
      'rate-limited',
    ));
  it('403 secondary rate limit with retry-after → rate-limited', () => {
    expect(
      classifyGitHubError(
        httpError(403, 'You have exceeded a secondary rate limit', { 'retry-after': '60' }),
      ).classification,
    ).toBe('rate-limited');
  });
  it('403 permission error → not-authorised (never "no alerts")', () => {
    expect(
      classifyGitHubError(httpError(403, 'Resource not accessible by integration')).classification,
    ).toBe('not-authorised');
  });
  it('401 → not-authorised', () =>
    expect(classifyGitHubError(httpError(401, 'Bad credentials')).classification).toBe(
      'not-authorised',
    ));
  it.each([
    [403, 'Dependabot alerts are disabled for this repository.'],
    [403, 'Advanced Security must be enabled for this repository to use code scanning.'],
    [404, 'Secret scanning is disabled on this repository.'],
    [404, 'no analysis found'],
  ])('%i "%s" → not-configured', (status, msg) =>
    expect(classifyGitHubError(httpError(status, msg)).classification).toBe('not-configured'),
  );
  it('M-2: a "dependency graph" message outside the SBOM export keeps its normal classification', () => {
    expect(
      classifyGitHubError(httpError(404, 'Dependency graph data not found')).classification,
    ).toBe('not-found');
    expect(
      classifyGitHubError(httpError(403, 'Dependency graph access denied')).classification,
    ).toBe('not-authorised');
    expect(
      classifyGitHubError(httpError(404, 'Dependency graph data not found'), {
        notConfigured: /dependency graph/i,
      }).classification,
    ).toBe('not-configured');
  });
  it('plain 404 → not-found (ambiguous, shown as unknown for security)', () => {
    expect(classifyGitHubError(httpError(404, 'Not Found'))).toEqual({
      classification: 'not-found',
      httpStatus: 404,
      message: 'Not Found',
    });
  });
  it('5xx and network errors → error', () => {
    expect(classifyGitHubError(httpError(502, 'Bad gateway')).classification).toBe('error');
    expect(classifyGitHubError(new TypeError('fetch failed'))).toEqual({
      classification: 'error',
      message: 'TypeError',
    });
  });
});

type Route = { status: number; body: unknown | Uint8Array; headers?: Record<string, string> };
function fakeFetch(routes: Record<string, Route>, seen: string[] = []) {
  return async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    seen.push(url.pathname + url.search);
    const route = Object.entries(routes).find(([p]) => decodeURIComponent(url.pathname) === p);
    const r = route?.[1] ?? { status: 404, body: { message: 'Not Found' } };
    if (r.body instanceof Uint8Array)
      return new Response(r.body as BodyInit, {
        status: r.status,
        headers: { 'content-type': 'application/zip', ...(r.headers ?? {}) },
      });
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) },
    });
  };
}
const provider = (routes: Record<string, Route>, seen?: string[]) =>
  new GitHubProvider(
    createGitHubClient(
      { mode: 'fine-grained-token', token: 'synthetic' },
      { fetch: fakeFetch(routes, seen) as typeof fetch },
    ),
    'fine-grained-token',
  );

describe('GitHubProvider', () => {
  it('control map: reads path commits, releases and commit dates (GET only)', async () => {
    const seen: string[] = [];
    const p = provider(
      {
        '/repos/o/a/commits': {
          status: 200,
          body: [
            { sha: 'b'.repeat(40), commit: { committer: { date: '2026-02-02T00:00:00Z' } } },
            {
              sha: 'a'.repeat(40),
              commit: { committer: null, author: { date: '2026-02-01T00:00:00Z' } },
            },
          ],
        },
        '/repos/o/a/commits/v1.2.0': {
          status: 200,
          body: { sha: 'c'.repeat(40), commit: { committer: { date: '2026-01-31T00:00:00Z' } } },
        },
        '/repos/o/a/releases': {
          status: 200,
          body: [
            {
              tag_name: 'v1.2.0',
              name: null,
              published_at: '2026-02-03T00:00:00Z',
              prerelease: false,
              draft: false,
              html_url: 'https://github.com/o/a/releases/1',
              assets: [],
            },
            {
              tag_name: 'v1.3.0',
              name: null,
              published_at: null,
              prerelease: false,
              draft: true,
              html_url: 'https://github.com/o/a/releases/2',
              assets: [],
            },
          ],
        },
      },
      seen,
    );
    expect(await p.listCommitsForPath('o/a', 'environments/prod.yaml')).toEqual({
      ok: true,
      data: [
        { sha: 'b'.repeat(40), committedAt: '2026-02-02T00:00:00Z' },
        { sha: 'a'.repeat(40), committedAt: '2026-02-01T00:00:00Z' },
      ],
    });
    expect(seen.some((u) => u.includes('path=environments%2Fprod.yaml'))).toBe(true);
    expect(await p.getCommitDate('o/a', 'v1.2.0')).toEqual({
      ok: true,
      data: '2026-01-31T00:00:00Z',
    });
    expect(await p.listReleases('o/a')).toMatchObject({ ok: true, data: [{ tagName: 'v1.2.0' }] });
  });

  it('control map: maps push protection, environments and closed-alert dates', async () => {
    const repo = (extra: Record<string, unknown>) => ({
      owner: { login: 'o' },
      name: 'a',
      full_name: 'o/a',
      html_url: 'https://github.com/o/a',
      private: true,
      visibility: 'private',
      default_branch: 'main',
      archived: false,
      pushed_at: null,
      updated_at: null,
      topics: [],
      ...extra,
    });
    const withPp = provider({
      '/repos/o/a': {
        status: 200,
        body: repo({
          security_and_analysis: { secret_scanning_push_protection: { status: 'enabled' } },
        }),
      },
      '/repos/o/a/environments': {
        status: 200,
        body: {
          total_count: 3,
          environments: [
            { name: 'dev', protection_rules: [], deployment_branch_policy: null },
            {
              name: 'staging',
              protection_rules: [{ id: 1, type: 'wait_timer', wait_timer: 5 }],
              deployment_branch_policy: null,
            },
            {
              name: 'production',
              protection_rules: [{ id: 2, type: 'required_reviewers', reviewers: [] }],
              deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
            },
          ],
        },
      },
      '/repos/o/a/dependabot/alerts': {
        status: 200,
        body: [
          {
            number: 4,
            state: 'fixed',
            dismissed_reason: null,
            security_advisory: { ghsa_id: 'GHSA-xxxx-xxxx-xxxx', cve_id: null, severity: 'high' },
            security_vulnerability: { severity: 'high', first_patched_version: null },
            dependency: { package: { name: 'left-pad' }, manifest_path: 'package.json' },
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-05T00:00:00Z',
            fixed_at: '2026-01-05T00:00:00Z',
            dismissed_at: null,
            html_url: 'https://github.com/o/a/security/dependabot/4',
          },
        ],
      },
    });
    expect(await withPp.getRepository('o/a')).toMatchObject({
      ok: true,
      data: { pushProtection: 'enabled' },
    });
    expect(await withPp.listEnvironments('o/a')).toEqual({
      ok: true,
      data: [
        { name: 'dev', protected: false, branchPolicy: false },
        { name: 'staging', protected: true, branchPolicy: false },
        { name: 'production', protected: true, branchPolicy: true },
      ],
    });
    expect(await withPp.listDependabotAlerts('o/a')).toMatchObject({
      ok: true,
      data: [{ resolvedAt: '2026-01-05T00:00:00Z' }],
    });

    const hidden = provider({
      '/repos/o/a': { status: 200, body: repo({}) },
      '/repos/o/a/environments': {
        status: 403,
        body: { message: 'Resource not accessible by integration' },
      },
    });
    expect(await hidden.getRepository('o/a')).toMatchObject({
      ok: true,
      data: { pushProtection: null },
    });
    expect(await hidden.listEnvironments('o/a')).toMatchObject({
      ok: false,
      error: { classification: 'not-authorised' },
    });
  });

  it('maps repository metadata to the minimal DTO', async () => {
    const p = provider({
      '/repos/example-org/demo': {
        status: 200,
        body: {
          owner: { login: 'example-org' },
          name: 'demo',
          full_name: 'example-org/demo',
          html_url: 'https://github.com/example-org/demo',
          visibility: 'private',
          private: true,
          default_branch: 'main',
          archived: false,
          pushed_at: '2026-01-01T00:00:00Z',
          topics: ['x'],
          extra_field_never_published: 'x',
        },
      },
    });
    const r = await p.getRepository('example-org/demo');
    expect(r).toEqual({
      ok: true,
      data: {
        owner: 'example-org',
        name: 'demo',
        fullName: 'example-org/demo',
        htmlUrl: 'https://github.com/example-org/demo',
        visibility: 'private',
        defaultBranch: 'main',
        archived: false,
        updatedAt: '2026-01-01T00:00:00Z',
        topics: ['x'],
        pushProtection: null,
      },
    });
  });

  it('returns classified errors on 403 / 404 / rate limit instead of throwing', async () => {
    const p = provider({
      '/repos/o/a/dependabot/alerts': {
        status: 403,
        body: { message: 'Dependabot alerts are disabled for this repository.' },
      },
      '/repos/o/a/secret-scanning/alerts': {
        status: 403,
        body: { message: 'Resource not accessible by integration' },
      },
      '/repos/o/a/code-scanning/alerts': {
        status: 403,
        body: { message: 'API rate limit exceeded' },
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '9999999999' },
      },
    });
    expect(await p.listDependabotAlerts('o/a')).toMatchObject({
      ok: false,
      error: { classification: 'not-configured', httpStatus: 403 },
    });
    expect(await p.listSecretScanningAlerts('o/a')).toMatchObject({
      ok: false,
      error: { classification: 'not-authorised' },
    });
    expect(await p.listCodeScanningAlerts('o/a')).toMatchObject({
      ok: false,
      error: { classification: 'rate-limited' },
    });
    expect(await p.getLatestRelease('o/a')).toMatchObject({
      ok: false,
      error: { classification: 'not-found' },
    });
  });

  it('requests secret scanning alerts with hide_secret and never maps the secret value', async () => {
    const seen: string[] = [];
    const p = provider(
      {
        '/repos/o/a/secret-scanning/alerts': {
          status: 200,
          body: [
            {
              number: 1,
              state: 'open',
              resolution: null,
              secret_type: 'github_personal_access_token',
              secret_type_display_name: 'GitHub Personal Access Token',
              secret: 'ghp_exampleSecretValue',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: null,
              html_url: 'https://github.com/o/a/security/secret-scanning/1',
              first_location_detected: { path: 'config/app.env', start_line: 3 },
            },
          ],
        },
      },
      seen,
    );
    const r = await p.listSecretScanningAlerts('o/a');
    expect(seen.some((s) => s.includes('hide_secret=true'))).toBe(true);
    expect(JSON.stringify(r)).not.toContain('ghp_exampleSecretValue');
    expect(JSON.stringify(r)).not.toContain('config/app.env');
    expect(r).toMatchObject({
      ok: true,
      data: [{ number: 1, secretTypeDisplayName: 'GitHub Personal Access Token' }],
    });
  });

  it('lists tags with their commit SHA and compares base...head (counters only)', async () => {
    const seen: string[] = [];
    const p = provider(
      {
        '/repos/o/a/tags': {
          status: 200,
          body: [{ name: 'v1.2.0', commit: { sha: 'c'.repeat(40), url: 'x' }, zipball_url: 'x' }],
        },
        [`/repos/o/a/compare/v1.2.0...${'d'.repeat(40)}`]: {
          status: 200,
          body: {
            status: 'ahead',
            ahead_by: 3,
            behind_by: 0,
            total_commits: 3,
            commits: [{ sha: 'secret-free' }],
            files: [{ patch: 'diff' }],
          },
        },
      },
      seen,
    );
    expect(await p.listTags('o/a')).toEqual({
      ok: true,
      data: [{ name: 'v1.2.0', sha: 'c'.repeat(40) }],
    });
    const cmp = await p.compareCommits('o/a', 'v1.2.0', 'd'.repeat(40));
    expect(cmp).toEqual({ ok: true, data: { status: 'ahead', aheadBy: 3, behindBy: 0 } });
    expect(JSON.stringify(cmp)).not.toContain('diff');
  });

  it('reads submodule refs and refuses non-submodule paths', async () => {
    const p = provider({
      '/repos/o/c/contents/services/api': {
        status: 200,
        body: { type: 'submodule', sha: 'b'.repeat(40) },
      },
      '/repos/o/c/contents/README.md': {
        status: 200,
        body: { type: 'file', size: 3, content: Buffer.from('hey').toString('base64') },
      },
    });
    expect(await p.getSubmoduleRef('o/c', 'services/api')).toEqual({
      ok: true,
      data: { path: 'services/api', sha: 'b'.repeat(40) },
    });
    expect(await p.getSubmoduleRef('o/c', 'README.md')).toMatchObject({
      ok: false,
      error: { classification: 'invalid-data' },
    });
    expect(await p.getFile('o/c', 'README.md')).toEqual({ ok: true, data: { text: 'hey' } });
  });
});

describe('authentication priority', () => {
  const app = {
    GH_APP_ID: '123',
    GH_APP_PRIVATE_KEY: 'synthetic-key',
    GH_APP_INSTALLATION_ID: '456',
  };
  it('uses the GitHub App when fully configured', () => {
    expect(resolveAuth('github', { ...app, GH_READ_TOKEN: 'x', GITHUB_TOKEN: 'y' }).mode).toBe(
      'github-app',
    );
  });
  it('then GH_READ_TOKEN, then GITHUB_TOKEN', () => {
    expect(resolveAuth('github', { GH_READ_TOKEN: 'x', GITHUB_TOKEN: 'y' }).mode).toBe(
      'fine-grained-token',
    );
    expect(resolveAuth('github', { GITHUB_TOKEN: 'y' }).mode).toBe('github-token');
  });
  it('mock only when explicitly requested', () => {
    expect(resolveAuth('mock', { GITHUB_TOKEN: 'y' }).mode).toBe('mock');
    expect(() => resolveAuth('github', {})).toThrow(AuthConfigError);
  });
  it('never falls back silently from a partial App configuration', () => {
    expect(() => resolveAuth('github', { GH_APP_ID: '123', GH_READ_TOKEN: 'x' })).toThrow(
      /incomplete/,
    );
  });
  it('error messages never contain credential values', () => {
    try {
      resolveAuth('github', { GH_APP_ID: '123', GH_APP_PRIVATE_KEY: 'synthetic-key-value' });
    } catch (e) {
      expect((e as Error).message).not.toContain('synthetic-key-value');
    }
  });
});

describe('GitHubProvider quality calls', () => {
  const art = (id: number, branch: string, created: string, extra: object = {}) => ({
    id,
    name: 'hub-quality-summary',
    size_in_bytes: 300,
    expired: false,
    created_at: created,
    workflow_run: { id: id * 10, head_branch: branch, head_repository_id: 7, repository_id: 7 },
    ...extra,
  });
  const list = (artifacts: unknown[]): Route => ({
    status: 200,
    body: { total_count: artifacts.length, artifacts },
  });
  const zipOf = (text: string): Route => ({
    status: 200,
    body: makeZip([{ name: 'quality-summary.json', data: text }]),
  });

  it('getQualitySummary picks newest artifact whose workflow_run.head_branch is the default branch', async () => {
    const p = provider({
      '/repos/o/a/actions/artifacts': list([
        art(3, 'feature/x', '2026-01-15T10:00:00Z'),
        art(1, 'main', '2026-01-10T10:00:00Z'),
        art(2, 'main', '2026-01-12T10:00:00Z'),
      ]),
      '/repos/o/a/actions/artifacts/2/zip': zipOf('{"main":"newest"}'),
      '/repos/o/a/actions/artifacts/1/zip': zipOf('{"main":"older"}'),
      '/repos/o/a/actions/artifacts/3/zip': zipOf('{"feature":true}'),
    });
    expect(await p.getQualitySummary('o/a', 'main')).toEqual({
      ok: true,
      data: {
        summaryText: '{"main":"newest"}',
        createdAt: '2026-01-12T10:00:00Z',
        runUrl: 'https://github.com/o/a/actions/runs/20',
      },
    });
  });

  it('getQualitySummary ignores fork-run artifacts whose head repository differs', async () => {
    const fork = art(3, 'main', '2026-01-15T10:00:00Z');
    fork.workflow_run.head_repository_id = 99;
    const p = provider({
      '/repos/o/a/actions/artifacts': list([fork, art(1, 'main', '2026-01-10T10:00:00Z')]),
      '/repos/o/a/actions/artifacts/1/zip': zipOf('{"same":"repo"}'),
      '/repos/o/a/actions/artifacts/3/zip': zipOf('{"fork":true}'),
    });
    expect(await p.getQualitySummary('o/a', 'main')).toMatchObject({
      ok: true,
      data: { summaryText: '{"same":"repo"}' },
    });
  });

  it.each([
    ['head_repository_id', { head_repository_id: null, repository_id: 7 }],
    ['repository_id', { head_repository_id: 7, repository_id: null }],
    ['both ids', { head_repository_id: null, repository_id: null }],
  ])('getQualitySummary does not trust a workflow_run with null %s', async (_, ids) => {
    const untrusted = art(3, 'main', '2026-01-15T10:00:00Z');
    Object.assign(untrusted.workflow_run, ids);
    const seen: string[] = [];
    const p = provider(
      {
        '/repos/o/a/actions/artifacts': list([untrusted]),
        '/repos/o/a/actions/artifacts/3/zip': zipOf('{"untrusted":true}'),
      },
      seen,
    );
    expect(await p.getQualitySummary('o/a', 'main')).toMatchObject({
      ok: false,
      error: { classification: 'not-found' },
    });
    expect(seen.some((s) => s.includes('/zip'))).toBe(false);
  });

  it('getQualitySummary finds the matching artifact on page 2 behind 30 PR-branch artifacts', async () => {
    const page1 = Array.from({ length: 30 }, (_, i) =>
      art(100 + i, `pr/${i}`, '2026-01-14T10:00:00Z'),
    );
    const page2 = [art(1, 'main', '2026-01-10T10:00:00Z')];
    const zip = makeZip([{ name: 'quality-summary.json', data: '{"p":2}' }]);
    const p = new GitHubProvider(
      createGitHubClient(
        { mode: 'fine-grained-token', token: 'synthetic' },
        {
          fetch: (async (input: string | URL | Request) => {
            const url = new URL(
              typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
            );
            if (url.pathname.endsWith('/zip'))
              return new Response(zip as BodyInit, {
                headers: { 'content-type': 'application/zip' },
              });
            const arts = url.searchParams.get('page') === '2' ? page2 : page1;
            return new Response(JSON.stringify({ total_count: 31, artifacts: arts }), {
              headers: { 'content-type': 'application/json' },
            });
          }) as typeof fetch,
        },
      ),
      'fine-grained-token',
    );
    expect(await p.getQualitySummary('o/a', 'main')).toMatchObject({
      ok: true,
      data: { summaryText: '{"p":2}' },
    });
  });

  it('getQualitySummary returns summaryText null when only expired artifacts exist on the branch', async () => {
    const p = provider({
      '/repos/o/a/actions/artifacts': list([
        art(1, 'main', '2026-01-10T10:00:00Z', { expired: true }),
        art(2, 'feature/x', '2026-01-11T10:00:00Z'),
      ]),
    });
    expect(await p.getQualitySummary('o/a', 'main')).toMatchObject({
      ok: true,
      data: { summaryText: null, createdAt: '2026-01-10T10:00:00Z' },
    });
  });

  it('getQualitySummary returns not-found when no artifact exists for the branch', async () => {
    const p = provider({
      '/repos/o/a/actions/artifacts': list([art(2, 'feature/x', '2026-01-11T10:00:00Z')]),
    });
    expect(await p.getQualitySummary('o/a', 'main')).toMatchObject({
      ok: false,
      error: { classification: 'not-found', httpStatus: 404 },
    });
  });

  it('getQualitySummary classifies 403 as not-authorised', async () => {
    const p = provider({
      '/repos/o/a/actions/artifacts': {
        status: 403,
        body: { message: 'Resource not accessible by integration' },
      },
    });
    expect(await p.getQualitySummary('o/a', 'main')).toMatchObject({
      ok: false,
      error: { classification: 'not-authorised' },
    });
  });

  it('getQualitySummary rejects size_in_bytes > 65536 as invalid-data without downloading', async () => {
    const seen: string[] = [];
    const p = provider(
      {
        '/repos/o/a/actions/artifacts': list([
          art(1, 'main', '2026-01-10T10:00:00Z', { size_in_bytes: 65_537 }),
        ]),
      },
      seen,
    );
    expect(await p.getQualitySummary('o/a', 'main')).toMatchObject({
      ok: false,
      error: { classification: 'invalid-data' },
    });
    expect(seen.some((s) => s.includes('/zip'))).toBe(false);
  });

  it('getQualitySummary maps a corrupt archive to invalid-data', async () => {
    const p = provider({
      '/repos/o/a/actions/artifacts': list([art(1, 'main', '2026-01-10T10:00:00Z')]),
      '/repos/o/a/actions/artifacts/1/zip': { status: 200, body: new Uint8Array([1, 2, 3]) },
    });
    expect(await p.getQualitySummary('o/a', 'main')).toMatchObject({
      ok: false,
      error: { classification: 'invalid-data' },
    });
  });

  /** Findings served 100 per page over `pages` pages, with a Link rel="next" header. */
  const pagedFindings = (pages: number, seen: string[] = []) =>
    new GitHubProvider(
      createGitHubClient(
        { mode: 'fine-grained-token', token: 'synthetic' },
        {
          fetch: (async (input: string | URL | Request) => {
            const url = new URL(
              typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
            );
            seen.push(url.pathname + url.search);
            const page = Number(url.searchParams.get('page') ?? '1');
            const next = new URL(url.href);
            next.searchParams.set('page', String(page + 1));
            const body = Array.from({ length: 100 }, () => ({
              rule: { category: 'maintainability', severity: 'note' },
            }));
            return new Response(JSON.stringify(body), {
              headers: {
                'content-type': 'application/json',
                ...(page < pages ? { link: `<${next.href}>; rel="next"` } : {}),
              },
            });
          }) as typeof fetch,
        },
      ),
      'fine-grained-token',
    );

  it('listCodeQualityFindings counts all findings when they fit in the 3-page cap', async () => {
    const r = await pagedFindings(3).listCodeQualityFindings('o/a');
    expect(r.ok && r.data.length).toBe(300);
  });

  it('listCodeQualityFindings past the 3-page cap is unknown, never an under-count', async () => {
    const seen: string[] = [];
    const r = await pagedFindings(5, seen).listCodeQualityFindings('o/a');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.classification).toBe('error');
      expect(r.error.message).toBe('FindingsPageCapExceeded');
      // The call itself succeeded: it proves the permission, only the count is unknown.
      expect(r.error.incomplete).toBe(true);
    }
    // Stops at the cap: no fourth page is requested.
    expect(seen).toHaveLength(3);
  });

  it('listCodeQualityFindings sends X-GitHub-Api-Version 2026-03-10 and maps rule.category / rule.severity only', async () => {
    let version: string | null = null;
    const base = fakeFetch({
      '/repos/o/a/code-quality/findings': {
        status: 200,
        body: [
          {
            number: 1,
            state: 'open',
            message: 'secret message',
            location: { path: 'src/a.ts' },
            rule: { id: 'r1', category: 'reliability', severity: 'warning', description: 'text' },
          },
        ],
      },
    });
    const p = new GitHubProvider(
      createGitHubClient(
        { mode: 'fine-grained-token', token: 'synthetic' },
        {
          fetch: (async (input: string | URL | Request, init?: RequestInit) => {
            version = new Headers(init?.headers).get('x-github-api-version');
            return base(input);
          }) as typeof fetch,
        },
      ),
      'fine-grained-token',
    );
    const r = await p.listCodeQualityFindings('o/a');
    expect(version).toBe('2026-03-10');
    expect(r).toEqual({ ok: true, data: [{ category: 'reliability', severity: 'warning' }] });
    if (r.ok) expect(Object.keys(r.data[0]!).sort()).toEqual(['category', 'severity']);
  });

  it('has no Code Quality setup call (the endpoint needs Administration: write)', () => {
    const p = provider({});
    expect((p as unknown as Record<string, unknown>).getCodeQualitySetup).toBeUndefined();
    const mock = new MockProvider('fixtures/github', () => new Date(0));
    expect((mock as unknown as Record<string, unknown>).getCodeQualitySetup).toBeUndefined();
  });
});

describe('GitHubProvider repository controls calls', () => {
  it('getBranchRules requests per_page 100 and maps only type and requiredApprovals', async () => {
    const seen: string[] = [];
    const p = provider(
      {
        '/repos/o/a/rules/branches/main': {
          status: 200,
          body: [
            {
              type: 'pull_request',
              parameters: {
                required_approving_review_count: 2,
                dismiss_stale_reviews_on_push: true,
              },
              ruleset_id: 7,
            },
            { type: 'non_fast_forward' },
          ],
        },
      },
      seen,
    );
    const r = await p.getBranchRules('o/a', 'main');
    expect(r).toEqual({
      ok: true,
      data: [
        { type: 'pull_request', requiredApprovals: 2 },
        { type: 'non_fast_forward', requiredApprovals: null },
      ],
    });
    if (r.ok)
      for (const rule of r.data) expect(Object.keys(rule)).toEqual(['type', 'requiredApprovals']);
    expect(seen[0]).toContain('per_page=100');
  });

  it('getBranchRules encodes a branch with a slash', async () => {
    const seen: string[] = [];
    const p = provider(
      { '/repos/o/a/rules/branches/release/1.x': { status: 200, body: [] } },
      seen,
    );
    expect(await p.getBranchRules('o/a', 'release/1.x')).toEqual({ ok: true, data: [] });
    expect(seen[0]).toContain('/rules/branches/release%2F1.x');
  });

  it('getBranchRules 403 → not-authorised; 404 → not-found', async () => {
    const p = provider({
      '/repos/o/a/rules/branches/main': {
        status: 403,
        body: { message: 'Resource not accessible by integration' },
      },
    });
    expect(await p.getBranchRules('o/a', 'main')).toMatchObject({
      ok: false,
      error: { classification: 'not-authorised' },
    });
    expect(await p.getBranchRules('o/b', 'main')).toMatchObject({
      ok: false,
      error: { classification: 'not-found' },
    });
  });

  it('getBranchHead maps protected true/false and missing → null', async () => {
    const branch = (extra: object) => ({
      status: 200,
      body: {
        name: 'main',
        commit: { sha: 'a'.repeat(40), html_url: 'x', commit: { committer: { date: 'd' } } },
        ...extra,
      },
    });
    const p = provider({
      '/repos/o/t/branches/main': branch({ protected: true }),
      '/repos/o/f/branches/main': branch({ protected: false }),
      '/repos/o/m/branches/main': branch({}),
    });
    const prot = async (r: string) => {
      const x = await p.getBranchHead(r, 'main');
      return x.ok ? x.data.protected : 'error';
    };
    expect(await prot('o/t')).toBe(true);
    expect(await prot('o/f')).toBe(false);
    expect(await prot('o/m')).toBeNull();
  });

  it('getClassicBranchProtection 404 → ok(null); maps allow_force_pushes.enabled false → forcePushBlocked true', async () => {
    const p = provider({
      '/repos/o/a/branches/main/protection': {
        status: 200,
        body: {
          required_pull_request_reviews: { required_approving_review_count: 1, secret: 'x' },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: true },
        },
      },
    });
    expect(await p.getClassicBranchProtection('o/a', 'main')).toEqual({
      ok: true,
      data: {
        pullRequestReviews: true,
        requiredApprovals: 1,
        statusChecks: false,
        forcePushBlocked: true,
        deletionBlocked: false,
      },
    });
    expect(await p.getClassicBranchProtection('o/none', 'main')).toEqual({ ok: true, data: null });
  });

  it('getLatestScorecardAnalysis sends tool_name=Scorecard and per_page=1; [] → ok(null)', async () => {
    const seen: string[] = [];
    const p = provider(
      {
        '/repos/o/a/code-scanning/analyses': { status: 200, body: [] },
        '/repos/o/b/code-scanning/analyses': {
          status: 200,
          body: [{ created_at: '2026-01-13T00:00:00Z', tool: { name: 'Scorecard' } }],
        },
      },
      seen,
    );
    expect(await p.getLatestScorecardAnalysis('o/a')).toEqual({ ok: true, data: null });
    expect(seen[0]).toContain('tool_name=Scorecard');
    expect(seen[0]).toContain('per_page=1');
    expect(await p.getLatestScorecardAnalysis('o/b')).toEqual({
      ok: true,
      data: { createdAt: '2026-01-13T00:00:00Z', toolName: 'Scorecard' },
    });
    expect(await p.getLatestScorecardAnalysis('o/missing')).toEqual({ ok: true, data: null });
  });

  it('getCustomPropertyValues maps property_name/value (string, array, null)', async () => {
    const p = provider({
      '/repos/o/a/properties/values': {
        status: 200,
        body: [
          { property_name: 'a', value: 'x', extra: 1 },
          { property_name: 'b', value: ['y', 'z'] },
          { property_name: 'c', value: null },
        ],
      },
    });
    expect(await p.getCustomPropertyValues('o/a')).toEqual({
      ok: true,
      data: [
        { name: 'a', value: 'x' },
        { name: 'b', value: ['y', 'z'] },
        { name: 'c', value: null },
      ],
    });
  });

  it('getFile rejects .github/workflows/../secrets.yml and .github/workflows/a/b.yml without calling the API', async () => {
    const seen: string[] = [];
    const p = provider({}, seen);
    for (const path of ['.github/workflows/../secrets.yml', '.github/workflows/a/b.yml']) {
      expect(await p.getFile('o/a', path, 'main')).toMatchObject({
        ok: false,
        error: { classification: 'invalid-data' },
      });
    }
    expect(seen).toEqual([]);
  });

  it('getFile reads a workflow file at a ref', async () => {
    const seen: string[] = [];
    const p = provider(
      {
        '/repos/o/a/contents/.github/workflows/ci.yml': {
          status: 200,
          body: { type: 'file', size: 2, content: Buffer.from('ok').toString('base64') },
        },
      },
      seen,
    );
    expect(await p.getFile('o/a', '.github/workflows/ci.yml', 'main')).toEqual({
      ok: true,
      data: { text: 'ok' },
    });
    expect(seen[0]).toContain('ref=main');
  });

  it('listDirectory forwards ref', async () => {
    const seen: string[] = [];
    const p = provider(
      {
        '/repos/o/a/contents/.github/workflows': {
          status: 200,
          body: [{ name: 'ci.yml', type: 'file' }],
        },
      },
      seen,
    );
    expect(await p.listDirectory('o/a', '.github/workflows', 'dev')).toEqual({
      ok: true,
      data: [{ name: 'ci.yml', type: 'file' }],
    });
    expect(seen[0]).toContain('ref=dev');
  });
});

describe('MockProvider repository controls calls', () => {
  const make = async (fixture: object) => {
    const dir = await mkdtemp(join(tmpdir(), 'hub-mock-'));
    await writeFile(join(dir, 'o__a.json'), JSON.stringify(fixture));
    return new MockProvider(dir, () => new Date('2026-01-15T00:00:00Z'));
  };
  const repository = {
    owner: 'o',
    name: 'a',
    fullName: 'o/a',
    htmlUrl: 'https://github.com/o/a',
    visibility: 'public',
    defaultBranch: 'main',
    archived: false,
    updatedAt: null,
    topics: [],
  };

  it('absent branchRules → ok([]); absent classic/scorecard/properties → ok(null)/ok([])', async () => {
    const p = await make({ repository });
    expect(await p.getBranchRules('o/a', 'main')).toEqual({ ok: true, data: [] });
    expect(await p.getClassicBranchProtection('o/a', 'main')).toEqual({ ok: true, data: null });
    expect(await p.getLatestScorecardAnalysis('o/a')).toEqual({ ok: true, data: null });
    expect(await p.getCustomPropertyValues('o/a')).toEqual({ ok: true, data: [] });
  });

  it('$error 403 fixture → not-authorised; configured values are returned', async () => {
    const p = await make({
      repository,
      branchRules: { $error: { classification: 'not-authorised', httpStatus: 403 } },
      customProperties: [{ name: 'team', value: 'x' }],
      scorecardAnalysis: { createdAt: '@now-3d', toolName: 'Scorecard' },
      directories: { '.github/workflows': [{ name: 'ci.yml', type: 'file' }] },
    });
    expect(await p.getBranchRules('o/a', 'main')).toMatchObject({
      ok: false,
      error: { classification: 'not-authorised' },
    });
    expect(await p.getCustomPropertyValues('o/a')).toEqual({
      ok: true,
      data: [{ name: 'team', value: 'x' }],
    });
    expect(await p.getLatestScorecardAnalysis('o/a')).toEqual({
      ok: true,
      data: { createdAt: '2026-01-12T00:00:00.000Z', toolName: 'Scorecard' },
    });
    expect(await p.listDirectory('o/a', '.github/workflows', 'main')).toMatchObject({ ok: true });
  });
});

describe('GitHubProvider: organisation teams (Members: read)', () => {
  const team = (slug: string, privacy = 'closed') => ({
    id: 1,
    slug,
    name: slug.toUpperCase(),
    privacy,
    description: 'never kept',
    members_url: 'https://api.github.com/x',
  });

  it('lists teams with slug, name and privacy only', async () => {
    const p = provider({
      '/orgs/example-org/teams': {
        status: 200,
        body: [team('platform'), team('secret-audit', 'secret')],
      },
    });
    const r = await p.listOrgTeams('example-org', { max: 10 });
    expect(r).toEqual({
      ok: true,
      data: {
        teams: [
          { org: 'example-org', slug: 'platform', name: 'PLATFORM', privacy: 'closed' },
          { org: 'example-org', slug: 'secret-audit', name: 'SECRET-AUDIT', privacy: 'secret' },
        ],
        limitReached: false,
      },
    });
    expect(JSON.stringify(r)).not.toContain('never kept');
    expect(JSON.stringify(r)).not.toContain('members_url');
  });

  it('stops at max with limitReached', async () => {
    const p = provider({
      '/orgs/example-org/teams': { status: 200, body: [team('a'), team('b'), team('c')] },
    });
    const r = await p.listOrgTeams('example-org', { max: 2 });
    expect(r.ok && r.data.teams.map((t) => t.slug)).toEqual(['a', 'b']);
    expect(r.ok && r.data.limitReached).toBe(true);
  });

  it('classifies 403 as not-authorised and 404 as not-found', async () => {
    const p = provider({
      '/orgs/example-org/teams': {
        status: 403,
        body: { message: 'Resource not accessible by integration' },
      },
    });
    expect(await p.listOrgTeams('example-org', { max: 10 })).toMatchObject({
      ok: false,
      error: { classification: 'not-authorised' },
    });
    expect(await provider({}).listOrgTeams('some-user', { max: 10 })).toMatchObject({
      ok: false,
      error: { classification: 'not-found' },
    });
  });

  it('maps team repository permissions: role_name first, then the highest permissions key', async () => {
    const repo = (name: string, extra: Record<string, unknown>) => ({
      full_name: `example-org/${name}`,
      description: 'never kept',
      ...extra,
    });
    const p = provider({
      '/orgs/example-org/teams/dev/repos': {
        status: 200,
        body: [
          repo('a', { role_name: 'push' }),
          repo('b', { permissions: { admin: false, maintain: true, push: true, pull: true } }),
          repo('c', { role_name: 'pull' }),
          repo('d', {}),
        ],
      },
    });
    const r = await p.listTeamRepositories('example-org', 'dev');
    expect(r).toEqual({
      ok: true,
      data: [
        { fullName: 'example-org/a', permission: 'write' },
        { fullName: 'example-org/b', permission: 'maintain' },
        { fullName: 'example-org/c', permission: 'read' },
        { fullName: 'example-org/d', permission: null },
      ],
    });
  });
});

describe('GitHubProvider: dependency-graph SBOM export', () => {
  const UUID = '0b9c5f3e-8f4b-4d3a-9d7e-2c1a6b5d4e3f';
  const API = '/repos/o/a/dependency-graph/sbom';
  const SIGNED = 'https://objects.githubusercontent.com/sbom/report.json?sig=abc';

  interface Call {
    path: string;
    redirect: RequestInit['redirect'];
    headers: Headers;
  }
  /** One handler for the API and for the download link; every request is recorded. */
  function sbomProvider(
    handler: (url: URL) => Response,
    opts: { sbomMaxBytes?: number; dependencyGraphExport?: boolean } = {},
  ) {
    const calls: Call[] = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      calls.push({
        path: url.origin + url.pathname,
        redirect: init?.redirect,
        headers: new Headers(init?.headers),
      });
      return handler(url);
    }) as typeof fetch;
    const p = new GitHubProvider(
      createGitHubClient({ mode: 'fine-grained-token', token: 'synthetic' }, { fetch: fetcher }),
      'fine-grained-token',
      { fetch: fetcher, dependencyGraphExport: true, ...opts },
    );
    return { p, calls };
  }
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  const sbomUrl = `https://api.github.com/repos/o/a/dependency-graph/sbom/fetch-report/${UUID}`;

  it('export switch off (the default): generate-report is never requested', async () => {
    const { p, calls } = sbomProvider(() => json(201, { sbom_url: sbomUrl }), {
      dependencyGraphExport: false,
    });
    expect(p.dependencyGraphExport).toBe(false);
    expect(await p.requestDependencySbom('o/a')).toMatchObject({
      ok: false,
      error: { classification: 'not-configured', skipped: true },
    });
    expect(calls).toHaveLength(0);
    // The default provider (no option) is off too.
    const dflt = new GitHubProvider(
      createGitHubClient(
        { mode: 'fine-grained-token', token: 'synthetic' },
        {
          fetch: (() => {
            throw new Error('network');
          }) as typeof fetch,
        },
      ),
      'fine-grained-token',
    );
    expect(dflt.dependencyGraphExport).toBe(false);
    expect(await dflt.requestDependencySbom('o/a')).toMatchObject({ ok: false });
  });

  it('the mock provider serves fixture SBOM data whatever the owner switch says', async () => {
    const mock = new MockProvider('fixtures/github', () => new Date(0));
    expect(mock.dependencyGraphExport).toBe(true);
  });

  it('requestDependencySbom extracts the uuid from sbom_url', async () => {
    const { p, calls } = sbomProvider(() => json(201, { sbom_url: sbomUrl }));
    expect(await p.requestDependencySbom('o/a')).toEqual({ ok: true, data: { uuid: UUID } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe(`https://api.github.com${API}/generate-report`);
  });

  it('requestDependencySbom with a foreign sbom_url path → invalid-data', async () => {
    for (const sbom_url of [
      'https://api.github.com/repos/o/a/other/path',
      'https://evil.example/x/dependency-graph/sbom/fetch-report/not-a-uuid',
      undefined,
    ]) {
      const { p } = sbomProvider(() => json(201, { sbom_url }));
      expect(await p.requestDependencySbom('o/a')).toMatchObject({
        ok: false,
        error: { classification: 'invalid-data' },
      });
    }
  });

  it('fetchDependencySbom 202 → pending', async () => {
    const { p, calls } = sbomProvider(() => json(202, {}));
    expect(await p.fetchDependencySbom('o/a', UUID)).toEqual({
      ok: true,
      data: { state: 'pending' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.redirect).toBe('manual');
    expect(calls[0]!.path).toBe(`https://api.github.com${API}/fetch-report/${UUID}`);
  });

  it('fetchDependencySbom 302 to an allowed host → ready text, downloaded without Authorization', async () => {
    const { p, calls } = sbomProvider((url) =>
      url.pathname.includes('/fetch-report/')
        ? new Response(null, { status: 302, headers: { location: SIGNED } })
        : new Response('{"spdxVersion":"SPDX-2.3"}'),
    );
    expect(await p.fetchDependencySbom('o/a', UUID)).toEqual({
      ok: true,
      data: { state: 'ready', text: '{"spdxVersion":"SPDX-2.3"}' },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers.get('authorization')).toBeTruthy();
    expect(calls[1]!.path).toBe('https://objects.githubusercontent.com/sbom/report.json');
    expect(calls[1]!.headers.has('authorization')).toBe(false);
    expect(calls[1]!.redirect).toBe('error');
  });

  it('fetchDependencySbom 302 to https://evil.example → invalid-data, no download request made', async () => {
    const { p, calls } = sbomProvider(
      () => new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } }),
    );
    expect(await p.fetchDependencySbom('o/a', UUID)).toMatchObject({
      ok: false,
      error: { classification: 'invalid-data', message: 'SBOM download host not allowed' },
    });
    expect(calls).toHaveLength(1);
  });

  it('fetchDependencySbom over the byte cap → invalid-data, incomplete', async () => {
    const { p } = sbomProvider(
      (url) =>
        url.pathname.includes('/fetch-report/')
          ? new Response(null, { status: 302, headers: { location: SIGNED } })
          : new Response('x'.repeat(2000)),
      { sbomMaxBytes: 1000 },
    );
    expect(await p.fetchDependencySbom('o/a', UUID)).toMatchObject({
      ok: false,
      error: { classification: 'invalid-data', message: 'SBOM too large', incomplete: true },
    });
  });

  it('a missing Location, a malformed uuid and an unexpected status are invalid-data', async () => {
    const noLocation = sbomProvider(() => new Response(null, { status: 302 }));
    expect(await noLocation.p.fetchDependencySbom('o/a', UUID)).toMatchObject({
      ok: false,
      error: { classification: 'invalid-data' },
    });
    const bad = sbomProvider(() => json(202, {}));
    expect(await bad.p.fetchDependencySbom('o/a', '../../admin')).toMatchObject({
      ok: false,
      error: { classification: 'invalid-data' },
    });
    expect(bad.calls).toHaveLength(0);
    const odd = sbomProvider(() => json(200, { sbom: {} }));
    expect(await odd.p.fetchDependencySbom('o/a', UUID)).toMatchObject({
      ok: false,
      error: { classification: 'invalid-data' },
    });
  });

  it('a failing download is a classified error, never a thrown one', async () => {
    const { p } = sbomProvider((url) =>
      url.pathname.includes('/fetch-report/')
        ? new Response(null, { status: 302, headers: { location: SIGNED } })
        : new Response('nope', { status: 500 }),
    );
    expect(await p.fetchDependencySbom('o/a', UUID)).toMatchObject({
      ok: false,
      error: { classification: 'error' },
    });
  });

  it('403 "Dependency graph is disabled for this repository" → not-configured; plain 403 → not-authorised', async () => {
    const disabled = sbomProvider(() =>
      json(403, { message: 'Dependency graph is disabled for this repository' }),
    );
    expect(await disabled.p.requestDependencySbom('o/a')).toMatchObject({
      ok: false,
      error: { classification: 'not-configured', httpStatus: 403 },
    });
    expect(await disabled.p.fetchDependencySbom('o/a', UUID)).toMatchObject({
      ok: false,
      error: { classification: 'not-configured' },
    });
    const plain = sbomProvider(() =>
      json(403, { message: 'Resource not accessible by integration' }),
    );
    expect(await plain.p.requestDependencySbom('o/a')).toMatchObject({
      ok: false,
      error: { classification: 'not-authorised' },
    });
  });

  it('M-2: on the SBOM export a 404 naming the dependency graph is not-configured; a plain 404 is not-found (unknown)', async () => {
    const named = sbomProvider(() =>
      json(404, { message: 'Dependency graph data not found for this repository' }),
    );
    expect(await named.p.requestDependencySbom('o/a')).toMatchObject({
      ok: false,
      error: { classification: 'not-configured', httpStatus: 404 },
    });
    const plain = sbomProvider(() => json(404, { message: 'Not Found' }));
    expect(await plain.p.requestDependencySbom('o/a')).toMatchObject({
      ok: false,
      error: { classification: 'not-found' },
    });
  });

  it('both calls send X-GitHub-Api-Version 2026-03-10', async () => {
    const { p, calls } = sbomProvider((url) =>
      url.pathname.endsWith('/generate-report') ? json(201, { sbom_url: sbomUrl }) : json(202, {}),
    );
    await p.requestDependencySbom('o/a');
    await p.fetchDependencySbom('o/a', UUID);
    expect(calls.map((c) => c.headers.get('x-github-api-version'))).toEqual([
      '2026-03-10',
      '2026-03-10',
    ]);
  });
});

describe('MockProvider: dependency-graph SBOM export', () => {
  async function make(fixture: unknown) {
    const dir = await mkdtemp(join(tmpdir(), 'hub-mock-sbom-'));
    await writeFile(join(dir, 'o__a.json'), JSON.stringify(fixture));
    return new MockProvider(dir, () => new Date('2026-01-15T12:00:00Z'));
  }
  const repository = {
    owner: 'o',
    name: 'a',
    fullName: 'o/a',
    htmlUrl: 'https://github.com/o/a',
    visibility: 'public',
    defaultBranch: 'main',
    archived: false,
    updatedAt: null,
    topics: [],
  };

  it('expand builds a valid SPDX 2.3 document with a DESCRIBES root and no real package names', async () => {
    const { summariseSpdx } = await import('../../collector/src/normalizers/sbom');
    const p = await make({
      repository,
      dependencySbom: {
        expand: {
          name: 'o/a',
          created: '@now-1h',
          packages: [
            { count: 3, license: 'MIT', purl: 'maven' },
            { count: 2, license: null, purl: null },
          ],
          extra: [{ name: 'canary-pkg', license: 'Apache-2.0', purl: 'maven' }],
        },
      },
    });
    const req = await p.requestDependencySbom('o/a');
    expect(req.ok).toBe(true);
    if (!req.ok) return;
    const fetched = await p.fetchDependencySbom('o/a', req.data.uuid);
    expect(fetched).toMatchObject({ ok: true, data: { state: 'ready' } });
    if (!fetched.ok || fetched.data.state !== 'ready') return;
    const summary = summariseSpdx(JSON.parse(fetched.data.text), [])!;
    expect(summary.specVersion).toBe('2.3');
    expect(summary.generatedAt).toBe('2026-01-15T11:00:00.000Z');
    expect(summary.packages).toBe(6);
    expect(summary.withoutLicense).toBe(2);
    expect(summary.licenses).toEqual([
      { id: 'MIT', count: 3 },
      { id: 'Apache-2.0', count: 1 },
    ]);
    expect(summary.ecosystems).toEqual([
      { id: 'maven', count: 4 },
      { id: 'unknown', count: 2 },
    ]);
  });

  it('pending makes every fetch pending; $error fails the request; absent is not-configured', async () => {
    const pending = await make({ repository, dependencySbom: { pending: true } });
    const req = await pending.requestDependencySbom('o/a');
    expect(req.ok && (await pending.fetchDependencySbom('o/a', req.data.uuid))).toEqual({
      ok: true,
      data: { state: 'pending' },
    });
    const denied = await make({
      repository,
      dependencySbom: { $error: { classification: 'not-authorised', httpStatus: 403 } },
    });
    expect(await denied.requestDependencySbom('o/a')).toMatchObject({
      ok: false,
      error: { classification: 'not-authorised' },
    });
    const absent = await make({ repository });
    expect(await absent.requestDependencySbom('o/a')).toMatchObject({
      ok: false,
      error: { classification: 'not-configured' },
    });
  });

  it('a document fixture is returned verbatim', async () => {
    const p = await make({ repository, dependencySbom: { document: { spdxVersion: 'SPDX-2.3' } } });
    const req = await p.requestDependencySbom('o/a');
    const fetched = req.ok && (await p.fetchDependencySbom('o/a', req.data.uuid));
    expect(fetched).toEqual({
      ok: true,
      data: { state: 'ready', text: '{"spdxVersion":"SPDX-2.3"}' },
    });
  });
});

describe('GitHubProvider: release assets, attestations, analyses by tool, supply-chain summary', () => {
  const D1 = `sha256:${'a1'.repeat(32)}`;
  const D2 = `sha256:${'b2'.repeat(32)}`;
  const releaseBody = (assets: unknown[]) => ({
    tag_name: 'v1.4.0',
    name: 'v1.4.0',
    published_at: '2026-01-10T00:00:00Z',
    prerelease: false,
    html_url: 'https://github.com/o/a/releases/tag/v1.4.0',
    assets,
  });

  it('latest release maps assets with digest; a "sha1:…" digest becomes null', async () => {
    const p = provider({
      '/repos/o/a/releases/latest': {
        status: 200,
        body: releaseBody([
          { name: 'app.tgz', digest: D1, download_url: 'https://x', size: 1 },
          { name: 'old.zip', digest: `sha1:${'c'.repeat(40)}` },
          { name: 'nodigest.bin', digest: null },
          { name: 'missing.bin' },
          { name: 'upper.bin', digest: `sha256:${'A'.repeat(64)}` },
        ]),
      },
    });
    expect(await p.getLatestRelease('o/a')).toMatchObject({
      ok: true,
      data: {
        tagName: 'v1.4.0',
        assets: [
          { name: 'app.tgz', digest: D1 },
          { name: 'old.zip', digest: null },
          { name: 'nodigest.bin', digest: null },
          { name: 'missing.bin', digest: null },
          { name: 'upper.bin', digest: null },
        ],
      },
    });
    const r = await p.getLatestRelease('o/a');
    expect(r.ok && Object.keys(r.data.assets[0]!).sort()).toEqual(['digest', 'name']);
  });

  it('a release without an assets array maps to an empty list', async () => {
    const p = provider({
      '/repos/o/a/releases/latest': {
        status: 200,
        body: { ...releaseBody([]), assets: undefined },
      },
    });
    expect(await p.getLatestRelease('o/a')).toMatchObject({ ok: true, data: { assets: [] } });
  });

  it('getAttestationPresence sends predicate_type provenance then sbom with per_page 1', async () => {
    const seen: string[] = [];
    const p = provider(
      {
        [`/repos/o/a/attestations/${D1}`]: {
          status: 200,
          body: { attestations: [{ bundle: {} }] },
        },
      },
      seen,
    );
    expect(await p.getAttestationPresence('o/a', D1)).toEqual({
      ok: true,
      data: { provenance: true, sbom: true },
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain('predicate_type=provenance');
    expect(seen[1]).toContain('predicate_type=sbom');
    expect(seen.every((s) => s.includes('per_page=1'))).toBe(true);
  });

  it('getAttestationPresence is per predicate: provenance present, sbom empty', async () => {
    const fetcher = (async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      const provenance = url.searchParams.get('predicate_type') === 'provenance';
      return new Response(JSON.stringify({ attestations: provenance ? [{}] : [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const p = new GitHubProvider(
      createGitHubClient({ mode: 'fine-grained-token', token: 'synthetic' }, { fetch: fetcher }),
      'fine-grained-token',
    );
    expect(await p.getAttestationPresence('o/a', D1)).toEqual({
      ok: true,
      data: { provenance: true, sbom: false },
    });
  });

  it('getAttestationPresence 404 → { provenance: false, sbom: false }', async () => {
    const p = provider({});
    expect(await p.getAttestationPresence('o/a', D2)).toEqual({
      ok: true,
      data: { provenance: false, sbom: false },
    });
  });

  it('getAttestationPresence 403 → not-authorised; 500 → error', async () => {
    const denied = provider({
      [`/repos/o/a/attestations/${D1}`]: {
        status: 403,
        body: { message: 'Resource not accessible by integration' },
      },
    });
    expect(await denied.getAttestationPresence('o/a', D1)).toMatchObject({
      ok: false,
      error: { classification: 'not-authorised' },
    });
    const broken = provider({
      [`/repos/o/a/attestations/${D1}`]: { status: 502, body: { message: 'Bad gateway' } },
    });
    expect(await broken.getAttestationPresence('o/a', D1)).toMatchObject({
      ok: false,
      error: { classification: 'error' },
    });
  });

  it('the DTO has exactly the keys provenance and sbom (no bundle)', async () => {
    const p = provider({
      [`/repos/o/a/attestations/${D1}`]: {
        status: 200,
        body: {
          attestations: [{ bundle: { secret: 'x' }, bundle_url: 'https://x', initiator: 'a' }],
        },
      },
    });
    const r = await p.getAttestationPresence('o/a', D1);
    expect(r.ok && Object.keys(r.data).sort()).toEqual(['provenance', 'sbom']);
    expect(JSON.stringify(r)).not.toContain('bundle');
  });

  it('getAttestationPresence refuses a digest that is not sha256:<64 hex> without a request', async () => {
    const seen: string[] = [];
    const p = provider({}, seen);
    expect(await p.getAttestationPresence('o/a', '../../admin')).toMatchObject({
      ok: false,
      error: { classification: 'invalid-data' },
    });
    expect(seen).toHaveLength(0);
  });

  it('listCodeScanningAnalyses passes tool_name, ref refs/heads/main, per_page 10 and maps category', async () => {
    const seen: string[] = [];
    const p = provider(
      {
        '/repos/o/a/code-scanning/analyses': {
          status: 200,
          body: [
            {
              created_at: '2026-01-14T00:00:00Z',
              tool: { name: 'Trivy' },
              category: 'trivy-image',
              sarif_id: 'x',
            },
            { created_at: '2026-01-13T00:00:00Z', tool: { name: 'Trivy' } },
          ],
        },
      },
      seen,
    );
    expect(await p.listCodeScanningAnalyses('o/a', 'Trivy', 'refs/heads/main')).toEqual({
      ok: true,
      data: [
        { createdAt: '2026-01-14T00:00:00Z', toolName: 'Trivy', category: 'trivy-image' },
        { createdAt: '2026-01-13T00:00:00Z', toolName: 'Trivy', category: null },
      ],
    });
    expect(seen[0]).toContain('tool_name=Trivy');
    expect(seen[0]).toContain('ref=refs%2Fheads%2Fmain');
    expect(seen[0]).toContain('per_page=10');
  });

  it('listCodeScanningAnalyses accepts a bare branch name, treats 404 as none and keeps errors classified', async () => {
    const seen: string[] = [];
    const none = provider({}, seen);
    expect(await none.listCodeScanningAnalyses('o/a', 'ZAP', 'main')).toEqual({
      ok: true,
      data: [],
    });
    expect(seen[0]).toContain('ref=refs%2Fheads%2Fmain');
    const denied = provider({
      '/repos/o/a/code-scanning/analyses': {
        status: 403,
        body: { message: 'Resource not accessible by integration' },
      },
    });
    expect(await denied.listCodeScanningAnalyses('o/a', 'ZAP', 'main')).toMatchObject({
      ok: false,
      error: { classification: 'not-authorised' },
    });
  });

  it('I-2: no analysis (404) or no Advanced Security (403) reads as not-configured, never unknown', async () => {
    const ctx = { projectId: 'p', policies: policies(), now: NOW, errors: [] };
    const rules = [{ tool: 'Trivy' }];
    for (const [status, message] of [
      [404, 'no analysis found'],
      [403, 'Advanced Security must be enabled for this repository to use code scanning.'],
    ] as const) {
      const p = provider({ '/repos/o/a/code-scanning/analyses': { status, body: { message } } });
      const r = await p.listCodeScanningAnalyses('o/a', 'Trivy', 'main');
      expect(r).toMatchObject({ ok: false, error: { classification: 'not-configured' } });
      expect(toolCandidate(ctx, rules, new Map([['trivy', r]]), []).state).toBe('not-configured');
    }
  });

  it('alerts map most_recent_instance.category', async () => {
    const p = provider({
      '/repos/o/a/code-scanning/alerts': {
        status: 200,
        body: [
          {
            number: 1,
            state: 'open',
            rule: { id: 'DS002', severity: 'error', description: 'x' },
            tool: { name: 'Trivy' },
            most_recent_instance: { category: 'trivy-image', location: { path: 'Dockerfile' } },
            created_at: '2026-01-01T00:00:00Z',
            html_url: 'https://github.com/o/a/security/code-scanning/1',
          },
          {
            number: 2,
            state: 'open',
            rule: { id: 'js/x' },
            tool: { name: 'CodeQL' },
            created_at: '2026-01-01T00:00:00Z',
            html_url: 'https://github.com/o/a/security/code-scanning/2',
          },
        ],
      },
    });
    const r = await p.listCodeScanningAlerts('o/a');
    expect(r.ok && r.data.map((a) => a.category)).toEqual(['trivy-image', null]);
  });

  describe('getSupplyChainSummary', () => {
    const art = (id: number, branch: string, created: string, extra: object = {}) => ({
      id,
      name: 'hub-supply-chain-summary',
      size_in_bytes: 300,
      expired: false,
      created_at: created,
      workflow_run: { id: id * 10, head_branch: branch, head_repository_id: 7, repository_id: 7 },
      ...extra,
    });
    const list = (artifacts: unknown[]): Route => ({
      status: 200,
      body: { total_count: artifacts.length, artifacts },
    });
    const zipOf = (name: string, text: string): Route => ({
      status: 200,
      body: makeZip([{ name, data: text }]),
    });

    it('picks the newest default-branch artifact named hub-supply-chain-summary and reads supply-chain-summary.json', async () => {
      const seen: string[] = [];
      const p = provider(
        {
          '/repos/o/a/actions/artifacts': list([
            art(3, 'feature/x', '2026-01-15T10:00:00Z'),
            art(1, 'main', '2026-01-10T10:00:00Z'),
            art(2, 'main', '2026-01-12T10:00:00Z'),
          ]),
          '/repos/o/a/actions/artifacts/2/zip': zipOf('supply-chain-summary.json', '{"newest":1}'),
        },
        seen,
      );
      expect(await p.getSupplyChainSummary('o/a', 'main')).toEqual({
        ok: true,
        data: {
          summaryText: '{"newest":1}',
          createdAt: '2026-01-12T10:00:00Z',
          runUrl: 'https://github.com/o/a/actions/runs/20',
        },
      });
      expect(seen[0]).toContain('name=hub-supply-chain-summary');
    });

    it('a quality-summary.json entry is not read as the supply-chain summary', async () => {
      const p = provider({
        '/repos/o/a/actions/artifacts': list([art(1, 'main', '2026-01-10T10:00:00Z')]),
        '/repos/o/a/actions/artifacts/1/zip': zipOf('quality-summary.json', '{}'),
      });
      expect(await p.getSupplyChainSummary('o/a', 'main')).toMatchObject({
        ok: false,
        error: { classification: 'invalid-data' },
      });
    });

    it('rejects size_in_bytes 65537 as invalid-data without downloading', async () => {
      const seen: string[] = [];
      const p = provider(
        {
          '/repos/o/a/actions/artifacts': list([
            art(1, 'main', '2026-01-10T10:00:00Z', { size_in_bytes: 65_537 }),
          ]),
        },
        seen,
      );
      expect(await p.getSupplyChainSummary('o/a', 'main')).toMatchObject({
        ok: false,
        error: { classification: 'invalid-data' },
      });
      expect(seen.some((s) => s.includes('/zip'))).toBe(false);
    });

    it('expired-only → summaryText null; none → not-found; fork runs are ignored', async () => {
      const expired = provider({
        '/repos/o/a/actions/artifacts': list([
          art(1, 'main', '2026-01-10T10:00:00Z', { expired: true }),
        ]),
      });
      expect(await expired.getSupplyChainSummary('o/a', 'main')).toMatchObject({
        ok: true,
        data: { summaryText: null },
      });
      const fork = art(3, 'main', '2026-01-15T10:00:00Z');
      fork.workflow_run.head_repository_id = 99;
      const none = provider({ '/repos/o/a/actions/artifacts': list([fork]) });
      expect(await none.getSupplyChainSummary('o/a', 'main')).toMatchObject({
        ok: false,
        error: { classification: 'not-found' },
      });
    });

    it('getQualitySummary still reads hub-quality-summary (behaviour unchanged)', async () => {
      const seen: string[] = [];
      const q = { ...art(1, 'main', '2026-01-10T10:00:00Z'), name: 'hub-quality-summary' };
      const p = provider(
        {
          '/repos/o/a/actions/artifacts': list([q]),
          '/repos/o/a/actions/artifacts/1/zip': zipOf('quality-summary.json', '{"q":1}'),
        },
        seen,
      );
      expect(await p.getQualitySummary('o/a', 'main')).toMatchObject({
        ok: true,
        data: { summaryText: '{"q":1}' },
      });
      expect(seen[0]).toContain('name=hub-quality-summary');
    });
  });

  describe('MockProvider', () => {
    const repository = {
      owner: 'o',
      name: 'a',
      fullName: 'o/a',
      htmlUrl: 'https://github.com/o/a',
      visibility: 'public',
      defaultBranch: 'main',
      archived: false,
      updatedAt: null,
      topics: [],
    };
    async function make(fixture: object) {
      const dir = await mkdtemp(join(tmpdir(), 'hub-mock-t3-'));
      await writeFile(join(dir, 'o__a.json'), JSON.stringify({ repository, ...fixture }));
      return new MockProvider(dir, () => new Date('2026-01-15T12:00:00Z'));
    }
    const release = {
      tagName: 'v1.4.0',
      name: null,
      publishedAt: '@now-5d',
      prerelease: false,
      htmlUrl: 'https://github.com/o/a/releases/tag/v1.4.0',
    };

    it('release assets default to [] and are returned when present', async () => {
      expect(await (await make({ latestRelease: release })).getLatestRelease('o/a')).toMatchObject({
        ok: true,
        data: { assets: [] },
      });
      const p = await make({
        latestRelease: { ...release, assets: [{ name: 'app.tgz', digest: D1 }] },
      });
      expect(await p.getLatestRelease('o/a')).toMatchObject({
        ok: true,
        data: { assets: [{ name: 'app.tgz', digest: D1 }] },
      });
    });

    it('attestations: per digest, absent → none, $error → error', async () => {
      const p = await make({
        attestations: {
          [D1]: { provenance: true, sbom: false },
          [D2]: { $error: { classification: 'not-authorised', httpStatus: 403 } },
        },
      });
      expect(await p.getAttestationPresence('o/a', D1)).toEqual({
        ok: true,
        data: { provenance: true, sbom: false },
      });
      expect(await p.getAttestationPresence('o/a', D2)).toMatchObject({
        ok: false,
        error: { classification: 'not-authorised' },
      });
      expect(await p.getAttestationPresence('o/a', `sha256:${'0'.repeat(64)}`)).toEqual({
        ok: true,
        data: { provenance: false, sbom: false },
      });
      expect(await (await make({})).getAttestationPresence('o/a', D1)).toEqual({
        ok: true,
        data: { provenance: false, sbom: false },
      });
      const all = await make({
        attestations: { $error: { classification: 'not-authorised', httpStatus: 403 } },
      });
      expect(await all.getAttestationPresence('o/a', D1)).toMatchObject({ ok: false });
    });

    it('analyses by tool (case-insensitive, @now tokens), absent → [], $error → error', async () => {
      const p = await make({
        codeScanningAnalyses: {
          ZAP: [{ createdAt: '@now-10d', toolName: 'ZAP', category: null }],
          Checkov: { $error: { classification: 'not-authorised', httpStatus: 403 } },
        },
      });
      expect(await p.listCodeScanningAnalyses('o/a', 'zap', 'main')).toEqual({
        ok: true,
        data: [{ createdAt: '2026-01-05T12:00:00.000Z', toolName: 'ZAP', category: null }],
      });
      expect(await p.listCodeScanningAnalyses('o/a', 'Checkov', 'main')).toMatchObject({
        ok: false,
      });
      expect(await p.listCodeScanningAnalyses('o/a', 'Trivy', 'main')).toEqual({
        ok: true,
        data: [],
      });
    });

    it('supply-chain summary: like the quality summary (expired, run url, absent → not-found)', async () => {
      const p = await make({
        supplyChainSummary: {
          summary: { schemaVersion: '1.0' },
          createdAt: '@now-1d',
          runId: 42,
        },
      });
      expect(await p.getSupplyChainSummary('o/a', 'main')).toEqual({
        ok: true,
        data: {
          summaryText: '{"schemaVersion":"1.0"}',
          createdAt: '2026-01-14T12:00:00.000Z',
          runUrl: 'https://github.com/o/a/actions/runs/42',
        },
      });
      const expired = await make({
        supplyChainSummary: { summary: {}, createdAt: '@now-30d', runId: 1, expired: true },
      });
      expect(await expired.getSupplyChainSummary('o/a', 'main')).toMatchObject({
        ok: true,
        data: { summaryText: null },
      });
      expect(await (await make({})).getSupplyChainSummary('o/a', 'main')).toMatchObject({
        ok: false,
        error: { classification: 'not-found' },
      });
    });
  });
});
