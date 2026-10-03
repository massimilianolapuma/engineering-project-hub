import { describe, expect, it } from 'vitest';
import { CatalogSchema, PoliciesSchema } from '@model/index';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  discover,
  guessType,
  slugify,
  workspacePatterns,
} from '../../collector/src/discovery/discover';
import { MockProvider } from '../../collector/src/providers/mock/mock-provider';
import { createLimiter } from '../../collector/src/util/concurrency';
import { fixedClock } from '../../collector/src/util/clock';

const policies = (audience: 'public' | 'restricted' = 'public') => {
  const p = PoliciesSchema.parse(parse(readFileSync('config/policies.yaml', 'utf8')));
  p.publication.audience = audience;
  return p;
};
const ctx = () => ({
  provider: new MockProvider('fixtures/github', fixedClock('2026-01-15T12:00:00.000Z')),
  limit: createLimiter(4),
  cache: new Map(),
});
const catalog = (discovery: object, projects: unknown[] = []) =>
  CatalogSchema.parse({ discovery, projects });

describe('workspace detection', () => {
  it('reads npm/yarn, pnpm, lerna, go.work and Cargo workspaces', () => {
    expect(
      workspacePatterns({
        'package.json': JSON.stringify({ workspaces: { packages: ['apps/*', './libs/core/'] } }),
        'pnpm-workspace.yaml': 'packages:\n  - services/*\n  - "!services/legacy"\n',
        'lerna.json': JSON.stringify({ packages: ['tools/*'] }),
        'go.work': 'go 1.22\n\nuse (\n\t./cmd/api\n\t./pkg/lib\n)\n',
        'Cargo.toml': '[workspace]\nmembers = ["crates/a", "crates/b"]\n',
      }).patterns.sort(),
    ).toEqual([
      'apps/*',
      'cmd/api',
      'crates/a',
      'crates/b',
      'libs/core',
      'pkg/lib',
      'services/*',
      'tools/*',
    ]);
  });
  it('falls back to conventional folders for turbo/nx without explicit patterns', () => {
    expect(workspacePatterns({ 'turbo.json': '{}' }).patterns).toEqual([
      'apps/*',
      'packages/*',
      'services/*',
      'libs/*',
    ]);
  });
  it('ignores malformed manifests', () => {
    expect(
      workspacePatterns({ 'package.json': '{oops', 'pnpm-workspace.yaml': ': :' }).patterns,
    ).toEqual([]);
  });
  it('guesses component types and slugs', () => {
    expect(
      ['apps/web', 'services/api', 'packages/ui', 'workers/mail', 'charts/x', 'misc/y'].map(
        guessType,
      ),
    ).toEqual(['webapp', 'service', 'library', 'worker', 'infrastructure', 'other']);
    expect(slugify('My_Repo.Name')).toBe('my-repo-name');
  });
});

describe('discovery (mock owner example-org)', () => {
  it('is skipped when disabled', async () => {
    expect(await discover(ctx(), catalog({ enabled: false }), policies())).toBeNull();
  });

  it('proposes coordinators, monorepos and single repositories; public only', async () => {
    const r = (await discover(
      ctx(),
      catalog({ enabled: true, owners: ['example-org'] }),
      policies(),
    ))!;
    const byRepo = Object.fromEntries(r.proposals.map((p) => [p.repository, p]));
    expect(byRepo['example-org/project-alpha-coordinator']).toMatchObject({ kind: 'coordinator' });
    expect(
      byRepo['example-org/project-alpha-coordinator']!.project.components.map(
        (c) => c.submodulePath,
      ),
    ).toEqual(['services/backend', 'apps/frontend', 'services/worker', 'deploy/helm']);
    expect(byRepo['example-org/platform-mono']).toMatchObject({ kind: 'monorepo' });
    expect(
      byRepo['example-org/platform-mono']!.project.components.map((c) => [c.id, c.path, c.type]),
    ).toEqual([
      ['web', 'apps/web', 'webapp'],
      ['api', 'services/api', 'service'],
      ['worker', 'services/worker', 'worker'],
    ]);
    expect(byRepo['example-org/docs-site']).toMatchObject({ kind: 'single', projectId: null });
    // Submodule targets are components, not projects; the private repository never appears.
    expect(byRepo['example-org/project-alpha-backend']).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('project-beta-api');
  });

  it('marks proposals already in the catalog', async () => {
    const existing = parse(readFileSync('config/projects/platform.yaml', 'utf8'));
    const r = (await discover(
      ctx(),
      catalog({ enabled: true, owners: ['example-org'] }, [existing]),
      policies(),
    ))!;
    expect(r.proposals.find((p) => p.repository === 'example-org/platform-mono')?.projectId).toBe(
      'platform',
    );
  });

  it('never lists private repositories on a public site, even if includePrivate is set', async () => {
    const r = (await discover(
      ctx(),
      catalog({ enabled: true, owners: ['example-org'], includePrivate: true }),
      policies('public'),
    ))!;
    expect(JSON.stringify(r)).not.toContain('project-beta-api');
    const restricted = (await discover(
      ctx(),
      catalog({ enabled: true, owners: ['example-org'], includePrivate: true }),
      policies('restricted'),
    ))!;
    expect(restricted.scanned).toBeGreaterThan(r.scanned);
  });

  it('records owner errors instead of failing', async () => {
    const r = (await discover(ctx(), catalog({ enabled: true, owners: ['nobody'] }), policies()))!;
    expect(r).toMatchObject({
      scanned: 0,
      proposals: [],
      errors: [{ target: 'nobody', classification: 'not-found' }],
    });
  });
});

describe('discovery resource bounds (untrusted manifests)', () => {
  it('expands at most MAX_WORKSPACE_PATTERNS patterns and caps components', async () => {
    const { MAX_WORKSPACE_PATTERNS } = await import('../../collector/src/discovery/discover');
    const listed: string[] = [];
    const repo = {
      owner: 'example-org',
      name: 'huge-mono',
      fullName: 'example-org/huge-mono',
      htmlUrl: 'https://github.com/example-org/huge-mono',
      visibility: 'public' as const,
      defaultBranch: 'main',
      archived: false,
      updatedAt: null,
      topics: [],
    };
    const provider = {
      listOwnerRepositories: async () => ({ ok: true as const, data: [repo] }),
      getFile: async (_r: string, path: string) =>
        path === 'package.json'
          ? {
              ok: true as const,
              data: {
                text: JSON.stringify({
                  workspaces: Array.from({ length: 500 }, (_, i) => `pkg${i}/*`),
                }),
              },
            }
          : { ok: false as const, error: { classification: 'not-found' as const } },
      listWorkflows: async () => ({ ok: true as const, data: [] }),
      listDirectory: async (_r: string, path: string) => {
        listed.push(path);
        return path === ''
          ? { ok: true as const, data: [{ name: 'package.json', type: 'file' as const }] }
          : {
              ok: true as const,
              data: Array.from({ length: 50 }, (_, i) => ({
                name: 'svc',
                type: 'dir' as const,
                i,
              })).map((e, i) => ({ name: `${e.name}${i}`, type: e.type })),
            };
      },
    };
    const c = { provider: provider as never, limit: createLimiter(4), cache: new Map() };
    const r = (await discover(c, catalog({ enabled: true, owners: ['example-org'] }), policies()))!;
    // Root listing + at most MAX_WORKSPACE_PATTERNS expansions, and the loop stops at 30 dirs.
    expect(listed.length).toBeLessThanOrEqual(1 + MAX_WORKSPACE_PATTERNS);
    expect(r.proposals[0]!.project.components.length).toBeLessThanOrEqual(30);
  });

  it('generates short unique ids with numeric suffixes', async () => {
    const { uniqueSlug } = await import('../../collector/src/discovery/discover');
    const used = new Set<string>();
    const ids = Array.from({ length: 5 }, () => uniqueSlug('api', used));
    expect(ids).toEqual(['api', 'api-2', 'api-3', 'api-4', 'api-5']);
    expect(uniqueSlug('coordinator', new Set())).toBe('coordinator-2');
    expect(uniqueSlug('x'.repeat(200), new Set()).length).toBeLessThanOrEqual(63);
  });
});
