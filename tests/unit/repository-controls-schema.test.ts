import { describe, expect, it, vi } from 'vitest';
import { RepositoryControlsHealthSchema, type Policies } from '@model/index';
import {
  collectReusableTargets,
  type CollectContext,
  type RepoControlsData,
} from '../../collector/src/collectors/collect';
import {
  evaluateRepositoryChecks,
  evaluateRepositoryControls,
  type RepoControlsInput,
} from '../../collector/src/evaluators/repository-controls';
import {
  parsedWorkflows,
  referencedRepositories,
} from '../../collector/src/normalizers/repository-controls-model';
import { classifyUses, parseWorkflow } from '../../collector/src/normalizers/workflow-refs';
import { fail, ok, type SourceProvider } from '../../collector/src/providers/types';
import { createLimiter } from '../../collector/src/util/concurrency';
import { NOW, policies, repoDto } from '../helpers/factories';
import type { RepoData } from '../../collector/src/collectors/collect';

/*
 * Publication invariant: whatever a monitored (or referenced) repository puts in its workflow
 * files, file names or tags, the repository-controls block must parse with the published schema.
 * A single failure here would make `serialise()` refuse the whole snapshot.
 */

const SHA = '0123456789abcdef0123456789abcdef01234567';
const DIGEST = 'sha256:' + 'ab'.repeat(32);
const NOT_FOUND = fail({ classification: 'not-found', httpStatus: 404 });

// --- deterministic PRNG (mulberry32) ----------------------------------------------------------
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;
  return { next, int, pick };
}
type Rng = ReturnType<typeof rng>;

const SAFE = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'];
const ODD = [
  '-',
  '_',
  '.',
  '/',
  ':',
  '@',
  '$',
  '{',
  '}',
  ' ',
  '<',
  '>',
  '"',
  "'",
  '`',
  '\\',
  '\u0000',
  '\u202e',
  'é',
  '…',
  '#',
  '?',
];
const SECRETS = ['ghp_' + 'a'.repeat(36), 'github_pat_' + 'b'.repeat(40)];
// Lengths clustered around the schema and regex boundaries.
const LENGTHS = [1, 2, 38, 39, 40, 95, 99, 100, 101, 128, 150, 195, 199, 200, 201, 250, 260];

function str(r: Rng, len: number, odd = 0.05): string {
  let s = '';
  for (let i = 0; i < len; i++) s += r.next() < odd ? r.pick(ODD) : r.pick(SAFE);
  return s;
}
const len = (r: Rng) => (r.next() < 0.5 ? r.pick(LENGTHS) : r.int(1, 60));

function ref(r: Rng): string {
  switch (r.int(0, 5)) {
    case 0:
      return SHA;
    case 1:
      return `v${r.int(0, 9)}.${r.int(0, 9)}.${r.int(0, 9)}`;
    case 2:
      return `v${r.int(0, 9)}`;
    case 3:
      return r.pick(SECRETS);
    default:
      return str(r, len(r));
  }
}

function uses(r: Rng): string {
  // Mostly well-formed parts, so that many references survive validation near the bounds.
  const odd = r.next() < 0.8 ? 0 : 0.02;
  const owner = str(r, r.next() < 0.8 ? r.int(1, 39) : len(r), odd);
  const repo = str(r, len(r), odd);
  switch (r.int(0, 6)) {
    case 0: {
      const image = str(r, len(r), odd);
      const tail = r.pick(['', `:${str(r, len(r), odd)}`, `@${DIGEST}`]);
      return `docker://${image}${tail}`;
    }
    case 1: {
      const file = `${str(r, len(r), odd)}.${r.pick(['yml', 'yaml'])}`;
      return `${owner}/${repo}/.github/workflows/${file}@${ref(r)}`;
    }
    case 2:
      return `./${str(r, len(r))}`;
    case 3:
      return str(r, len(r), 0.3);
    default: {
      const path = Array.from({ length: r.int(0, 3) }, () => str(r, r.int(1, 100), odd));
      return `${[owner, repo, ...path].join('/')}@${ref(r)}`;
    }
  }
}

function fileName(r: Rng): string {
  const pool = r.int(0, 3);
  if (pool === 0) return `${str(r, len(r), 0)}.yml`;
  if (pool === 1) return `${str(r, len(r), 0.1)}.yaml`;
  return `${'w'.repeat(r.pick([1, 95, 96, 97, 98, 99, 100, 101, 110]))}.yml`;
}

function tag(r: Rng): string {
  return r.pick([
    `v${r.int(0, 9)}.${r.int(0, 9)}.${r.int(0, 9)}`,
    `v${r.int(0, 9)}.${r.int(0, 9)}.${r.int(0, 9)}-rc.${r.int(0, 9)}`,
    'v1.0.0-' + 'x'.repeat(r.pick([90, 93, 94, 120, 200])),
    str(r, len(r), 0.1),
    r.pick(SECRETS),
  ]);
}

// --- pipeline -------------------------------------------------------------------------------
function stub(r: Rng) {
  return {
    getRepository: vi.fn(async (repo: string) =>
      ok(repoDto(repo.split('/')[1] ?? 'x', r.pick(['public', 'private', 'internal'] as const))),
    ),
    getLatestRelease: vi.fn(async () =>
      r.next() < 0.5
        ? NOT_FOUND
        : ok({
            tagName: tag(r),
            name: null,
            publishedAt: null,
            prerelease: false,
            htmlUrl: null,
          }),
    ),
    getLatestTag: vi.fn(async () => ok({ name: tag(r), sha: SHA })),
    listTags: vi.fn(async () =>
      ok(Array.from({ length: r.int(0, 5) }, () => ({ name: tag(r), sha: SHA }))),
    ),
  };
}

async function runOnce(seed: number, p: Policies) {
  const r = rng(seed);
  const workflowFiles = new Map<string, ReturnType<typeof ok<{ text: string }>>>();
  const nFiles = r.int(1, 4);
  for (let i = 0; i < nFiles; i++) {
    const lines = Array.from({ length: r.int(1, 8) }, () => uses(r));
    const text =
      'jobs:\n' +
      lines
        .map((u, j) =>
          j % 2 === 0
            ? `  j${j}:\n    uses: ${JSON.stringify(u)}\n`
            : `  j${j}:\n    steps:\n      - uses: ${JSON.stringify(u)}\n`,
        )
        .join('');
    workflowFiles.set(fileName(r), ok({ text }));
  }
  const controls = {
    workflowDir: ok([]),
    workflowFiles,
    omittedFiles: 0,
    rules: ok([]),
    classic: null,
    scorecardAnalysis: ok(null),
  } as unknown as RepoControlsData;
  const { targets, shaTargets } = referencedRepositories([{ controls } as unknown as RepoData]);
  const ctx: CollectContext = {
    provider: stub(r) as unknown as SourceProvider,
    limit: createLimiter(4),
    cache: new Map(),
    policies: p,
  };
  const reusable = await collectReusableTargets(ctx, targets, shaTargets);
  const { files, unreadable } = parsedWorkflows(controls);
  const input: RepoControlsInput = {
    repository: 'example-org/svc',
    componentIds: ['coordinator'],
    branch: 'main',
    available: true,
    archived: false,
    notApplicable: [],
    workflows: { state: 'read', files, unreadable, capped: false },
    reusable,
    rules: ok([]),
    protected: true,
    classic: null,
    scorecardAnalysis: ok(null),
    scorecardAlerts: [],
    publicDetails: r.next() < 0.8,
    repositoryUrlFor: (t) => `https://github.com/${t}`,
  };
  const repo = evaluateRepositoryChecks(input, p);
  return evaluateRepositoryControls([repo], p, NOW.toISOString()).health;
}

const issues = (h: unknown) => {
  const res = RepositoryControlsHealthSchema.safeParse(h);
  return res.success ? [] : res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('repository controls output always passes the published schema', () => {
  it('classifyUses never yields a target or ref the schema would refuse', () => {
    const r = rng(7);
    for (let i = 0; i < 5000; i++) {
      const raw = uses(r);
      const out = classifyUses(raw);
      if (out.kind === 'invalid' || out.kind === 'local') continue;
      expect(out.target!.length, raw).toBeLessThanOrEqual(200);
      expect(raw.includes(out.target!.replace(/^docker:\/\//, '')), raw).toBe(true);
      if (out.ref !== null) {
        expect(out.ref.length, raw).toBeLessThanOrEqual(100);
        expect(raw.includes(out.ref), raw).toBe(true);
      }
    }
  });

  it('adversarial workflows, file names and tags (public and restricted audiences)', async () => {
    const publicP = policies();
    const restricted = policies((p) => {
      p.publication.audience = 'restricted';
    });
    for (let seed = 1; seed <= 400; seed++) {
      const health = await runOnce(seed, seed % 2 ? publicP : restricted);
      expect(issues(health), `seed ${seed}`).toEqual([]);
    }
  });
});

describe('schema shape', () => {
  it('perCheck holds exactly the six checks', async () => {
    const health = await runOnce(1, policies());
    expect(issues(health)).toEqual([]);
    expect(issues({ ...health, perCheck: health.perCheck.slice(0, 5) })).not.toEqual([]);
  });
});

describe('over-long identifiers never abort publication', () => {
  const P = policies();
  const evaluate = (input: Partial<RepoControlsInput>) =>
    evaluateRepositoryControls(
      [
        evaluateRepositoryChecks(
          {
            repository: 'example-org/svc',
            componentIds: ['coordinator'],
            branch: 'main',
            available: true,
            archived: false,
            notApplicable: [],
            workflows: { state: 'read', files: [], unreadable: 0, capped: false },
            reusable: new Map(),
            rules: ok([]),
            protected: true,
            classic: null,
            scorecardAnalysis: ok(null),
            scorecardAlerts: [],
            publicDetails: true,
            repositoryUrlFor: (t) => `https://github.com/${t}`,
            ...input,
          },
          P,
        ),
      ],
      P,
      NOW.toISOString(),
    ).health;
  const one = (text: string, name = 'ci.yml') => ({
    state: 'read' as const,
    files: [parseWorkflow(name, text)],
    unreadable: 0,
    capped: false,
  });

  it('a 203-character action target is invalid (unknown), not published', () => {
    const u = `o/${'r'.repeat(100)}/${'p'.repeat(100)}@v1`;
    expect(classifyUses(u).kind).toBe('invalid');
    const h = evaluate({ workflows: one(`jobs:\n  a:\n    steps:\n      - uses: ${u}\n`) });
    expect(issues(h)).toEqual([]);
    expect(h.repositories[0]!.checks[0]!.state).toBe('unknown');
  });

  it('a 204-character docker target is invalid', () => {
    expect(classifyUses(`docker://${'a'.repeat(195)}:1`).kind).toBe('invalid');
    expect(classifyUses(`docker://${'a'.repeat(191)}:1`).kind).toBe('docker');
  });

  it('a docker tag over 100 characters is invalid, never truncated', () => {
    expect(classifyUses(`docker://alpine:${'1'.repeat(101)}`).kind).toBe('invalid');
    expect(classifyUses(`docker://alpine:${'1'.repeat(100)}`)).toMatchObject({
      kind: 'docker',
      ref: '1'.repeat(100),
    });
  });

  it('a reusable workflow target over 200 characters is invalid', () => {
    const u = `o/${'r'.repeat(100)}/.github/workflows/${'f'.repeat(80)}.yml@v1`;
    expect(classifyUses(u).kind).toBe('invalid');
  });

  it('a workflow file name over 100 characters is unreadable, never renamed', () => {
    const name = `${'w'.repeat(110)}.yml`;
    const controls = {
      workflowDir: ok([{ name, type: 'file' }]),
      workflowFiles: new Map([
        [name, ok({ text: 'jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n' })],
      ]),
      omittedFiles: 0,
      rules: ok([]),
      classic: null,
      scorecardAnalysis: ok(null),
    } as unknown as RepoControlsData;
    const parsed = parsedWorkflows(controls);
    expect(parsed.files).toEqual([]);
    expect(parsed.unreadable).toBe(1);
    const h = evaluate({ workflows: { state: 'read', ...parsed, capped: false } });
    expect(issues(h)).toEqual([]);
    expect(h.repositories[0]!.checks[0]!.state).toBe('unknown');
  });

  it('a latest tag over 100 characters is dropped (unknown), never truncated', async () => {
    const long = 'v1.0.0-' + 'x'.repeat(150);
    const ctx: CollectContext = {
      provider: {
        getRepository: vi.fn(async () => ok(repoDto('t'))),
        getLatestRelease: vi.fn(async () =>
          ok({ tagName: long, name: null, publishedAt: null, prerelease: false, htmlUrl: null }),
        ),
        listTags: vi.fn(async () =>
          ok([
            { name: long, sha: SHA },
            { name: 'v1.0.0', sha: SHA },
          ]),
        ),
      } as unknown as SourceProvider,
      limit: createLimiter(4),
      cache: new Map(),
      policies: P,
    };
    const reusable = await collectReusableTargets(ctx, ['o/t'], new Set(['o/t']));
    expect(reusable.get('o/t')).toEqual({
      latest: null,
      tags: [{ name: 'v1.0.0', sha: SHA }],
      visible: true,
    });
    const h = evaluate({
      reusable,
      workflows: one('jobs:\n  a:\n    uses: o/t/.github/workflows/b.yml@v1.0.0\n'),
    });
    expect(issues(h)).toEqual([]);
    expect(h.repositories[0]!.reusableWorkflows[0]).toMatchObject({
      latest: null,
      status: 'unknown',
    });
  });

  it('a public repository calling a private reusable workflow publishes no latest and no url', async () => {
    const ctx: CollectContext = {
      provider: {
        getRepository: vi.fn(async () => ok(repoDto('shared', 'private'))),
        getLatestRelease: vi.fn(async () =>
          ok({
            tagName: 'v9.0.0',
            name: null,
            publishedAt: null,
            prerelease: false,
            htmlUrl: null,
          }),
        ),
      } as unknown as SourceProvider,
      limit: createLimiter(4),
      cache: new Map(),
      policies: P,
    };
    const reusable = await collectReusableTargets(ctx, ['o/shared']);
    const h = evaluate({
      reusable,
      workflows: one('jobs:\n  a:\n    uses: o/shared/.github/workflows/b.yml@v8.0.0\n'),
    });
    expect(issues(h)).toEqual([]);
    expect(h.repositories[0]!.reusableWorkflows).toEqual([
      {
        workflow: 'ci.yml',
        target: 'o/shared/.github/workflows/b.yml',
        ref: 'v8.0.0',
        latest: null,
        status: 'unknown',
        url: null,
      },
    ]);
    expect(JSON.stringify(h)).not.toContain('v9.0.0');
  });
});
