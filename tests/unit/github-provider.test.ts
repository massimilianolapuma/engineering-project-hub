import { describe, expect, it } from 'vitest';
import { classifyGitHubError } from '../../collector/src/providers/github/errors';
import {
  createGitHubClient,
  GitHubProvider,
} from '../../collector/src/providers/github/github-provider';
import { AuthConfigError, resolveAuth } from '../../collector/src/providers/auth';

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

type Route = { status: number; body: unknown; headers?: Record<string, string> };
function fakeFetch(routes: Record<string, Route>, seen: string[] = []) {
  return async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    seen.push(url.pathname + url.search);
    const route = Object.entries(routes).find(([p]) => decodeURIComponent(url.pathname) === p);
    const r = route?.[1] ?? { status: 404, body: { message: 'Not Found' } };
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
