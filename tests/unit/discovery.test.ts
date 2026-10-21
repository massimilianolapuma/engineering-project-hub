import { describe, expect, it, vi } from 'vitest';
import { CatalogSchema, PoliciesSchema } from '@model/index';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  discover,
  guessType,
  readHints,
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
  policies: policies(),
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
    const c = {
      provider: provider as never,
      limit: createLimiter(4),
      cache: new Map(),
      policies: policies(),
    };
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

describe('discovery hints', () => {
  const cfg = (over: object = {}) =>
    catalog({
      enabled: true,
      owners: ['example-org'],
      topics: true,
      customProperties: true,
      ...over,
    }).discovery;
  const dto = (topics: string[]) => ({
    owner: 'o',
    name: 'r',
    fullName: 'o/r',
    htmlUrl: 'https://github.com/o/r',
    visibility: 'public' as const,
    defaultBranch: 'main',
    archived: false,
    updatedAt: null,
    topics,
  });
  const prop = (name: string, value: string | string[] | null) => ({ name, value });

  it('property hub-project=alpha beats topic project-beta', () => {
    const h = readHints(dto(['project-beta']), [prop('hub-project', 'alpha')], cfg());
    expect(h.project).toBe('alpha');
    expect(h.hints).toEqual([{ source: 'property', key: 'hub-project', value: 'alpha' }]);
  });
  it('topic type-worker gives type worker', () => {
    expect(readHints(dto(['type-worker']), null, cfg()).type).toBe('worker');
  });
  it('an invalid type property is dropped with evidence', () => {
    const h = readHints(dto([]), [prop('hub-component-type', 'banana')], cfg());
    expect(h.type).toBeNull();
    expect(h.evidence).toContain('ignored hint hub-component-type');
  });
  it('two project-* topics are ambiguous', () => {
    const h = readHints(dto(['project-a', 'project-b']), null, cfg());
    expect(h.project).toBeNull();
    expect(h.evidence).toContain('ambiguous project topics');
  });
  it('an array value is ignored', () => {
    const h = readHints(dto([]), [prop('hub-project', ['a', 'b'])], cfg());
    expect(h.project).toBeNull();
    expect(h.evidence).toContain('ignored hint hub-project');
  });
  it('an unconfigured property never appears', () => {
    const h = readHints(dto([]), [prop('cost-center', 'CC-1234')], cfg());
    expect(JSON.stringify(h)).not.toMatch(/CC-1234|cost-center/);
  });
  it('topics false: topic hints are not read', () => {
    expect(readHints(dto(['project-x']), null, cfg({ topics: false })).project).toBeNull();
  });

  it('customProperties false: properties are not requested', async () => {
    const c = ctx();
    const spy = vi.spyOn(c.provider, 'getCustomPropertyValues');
    await discover(
      c,
      catalog({ enabled: true, owners: ['example-org'], customProperties: false }),
      policies(),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  const run = async (c = ctx(), existing: unknown[] = []) =>
    (await discover(
      c,
      catalog(
        { enabled: true, owners: ['example-org'], topics: true, customProperties: true },
        existing,
      ),
      policies(),
    ))!;

  it('tools-api and tools-cli become one grouped proposal', async () => {
    const r = await run();
    const grouped = r.proposals.filter((p) => p.kind === 'grouped');
    expect(grouped).toHaveLength(1);
    const g = grouped[0]!;
    expect(g.project.id).toBe('tools');
    expect(g.project.coordinator.repository).toBe('example-org/tools-api');
    expect(g.project.components).toMatchObject([
      {
        id: 'tools-cli',
        type: 'other',
        repository: 'example-org/tools-cli',
        versionSource: 'release',
      },
    ]);
    expect(
      r.proposals.filter((p) => /tools-(api|cli)$/.test(p.repository) && p.kind === 'single'),
    ).toEqual([]);
  });
  it('docs-site is suggested for the existing project platform', async () => {
    const existing = parse(readFileSync('config/projects/platform.yaml', 'utf8'));
    const r = await run(ctx(), [existing]);
    const d = r.proposals.find((p) => p.repository === 'example-org/docs-site')!;
    expect(d.hintedProjectId).toBe('platform');
    expect(d.hints).toEqual([{ source: 'property', key: 'hub-project', value: 'platform' }]);
  });
  it('hinted type and component id also apply to a submodule component', async () => {
    const c = ctx();
    const orig = c.provider.getCustomPropertyValues.bind(c.provider);
    c.provider.getCustomPropertyValues = async (repo: string) =>
      repo === 'example-org/project-alpha-backend'
        ? {
            ok: true as const,
            data: [
              { name: 'hub-component-type', value: 'worker' },
              { name: 'hub-component', value: 'api-server' },
            ],
          }
        : orig(repo);
    const r = await run(c);
    const coordinator = r.proposals.find(
      (p) => p.repository === 'example-org/project-alpha-coordinator',
    )!;
    const m = coordinator.project.components.find(
      (x) => x.repository === 'example-org/project-alpha-backend',
    )!;
    expect(m).toMatchObject({ id: 'api-server', type: 'worker' });
  });
  it('a repository that is a catalog component is not suggested for that project', async () => {
    const existing = parse(readFileSync('config/projects/platform.yaml', 'utf8'));
    existing.components.push({
      id: 'docs',
      name: 'Docs',
      repository: 'example-org/docs-site',
      type: 'webapp',
      versionSource: 'release',
    });
    const r = await run(ctx(), [existing]);
    const d = r.proposals.find((p) => p.repository === 'example-org/docs-site')!;
    expect(d.hintedProjectId).toBeNull();
  });
  it('never leaks the unconfigured property', async () => {
    const s = JSON.stringify(await run());
    expect(s).not.toContain('CC-1234');
    expect(s).not.toContain('cost-center');
  });
  it('properties 403: error recorded, topic hints still apply', async () => {
    const c = ctx();
    const orig = c.provider.getCustomPropertyValues.bind(c.provider);
    c.provider.getCustomPropertyValues = async (repo: string) =>
      repo === 'example-org/tools-cli'
        ? { ok: false as const, error: { classification: 'not-authorised' as const } }
        : orig(repo);
    const r = await run(c);
    expect(r.errors).toContainEqual({
      target: 'example-org/tools-cli',
      classification: 'not-authorised',
    });
    expect(r.proposals.filter((p) => p.kind === 'grouped')).toHaveLength(1);
  });
  it('keeps the proposal order coordinator, monorepo, grouped, single', async () => {
    const kinds = (await run()).proposals.map((p) => p.kind);
    const order = ['coordinator', 'monorepo', 'grouped', 'single'];
    expect([...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(kinds);
    expect(new Set(kinds)).toEqual(new Set(order));
  });
});
