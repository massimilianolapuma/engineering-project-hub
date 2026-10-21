import { describe, expect, it, vi } from 'vitest';
import {
  classifyUses,
  MAX_REFS_PER_FILE,
  parseWorkflow,
  reusableStatus,
  type TargetVersions,
} from '../../collector/src/normalizers/workflow-refs';
import { CANARIES } from '../helpers/canaries';

const A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const B = 'b2c3d4e5f60718293a4b5c6d7e8f901234567890';
const C = 'c3d4e5f60718293a4b5c6d7e8f9012345678901a';
const D = '0123456789abcdef0123456789abcdef01234567';

describe('classifyUses', () => {
  it('local path', () => {
    expect(classifyUses('./.github/actions/lint')).toMatchObject({
      kind: 'local',
      pinned: false,
      target: null,
    });
  });
  it('action with a tag', () => {
    expect(classifyUses('actions/checkout@v4')).toMatchObject({
      kind: 'action',
      target: 'actions/checkout',
      ref: 'v4',
      pinned: false,
    });
  });
  it('action pinned to a full SHA', () => {
    expect(classifyUses(`actions/checkout@${D}`)).toMatchObject({ kind: 'action', pinned: true });
  });
  it('uppercase SHA is not pinned', () => {
    expect(classifyUses('actions/checkout@0123456789ABCDEF0123456789abcdef01234567').pinned).toBe(
      false,
    );
  });
  it('short SHA is not pinned', () => {
    expect(classifyUses('actions/checkout@0123456').pinned).toBe(false);
  });
  it('action with a sub path', () => {
    expect(classifyUses('github/codeql-action/upload-sarif@v3')).toMatchObject({
      kind: 'action',
      target: 'github/codeql-action/upload-sarif',
    });
  });
  it('reusable workflow', () => {
    expect(classifyUses('example-shared/ci-templates/.github/workflows/build.yml@v2.1.0')).toEqual({
      kind: 'reusable-workflow',
      target: 'example-shared/ci-templates/.github/workflows/build.yml',
      owner: 'example-shared',
      repo: 'ci-templates',
      ref: 'v2.1.0',
      pinned: false,
    });
  });
  it('a ref must start with a letter or digit', () => {
    for (const ref of ['.', '/', '-x', '.v1', '/main'])
      expect(classifyUses(`actions/checkout@${ref}`).kind, ref).toBe('invalid');
    expect(classifyUses('actions/checkout@release/1.x').kind).toBe('action');
  });
  it('docker image by tag', () => {
    expect(classifyUses('docker://alpine:3.20')).toMatchObject({
      kind: 'docker',
      target: 'docker://alpine',
      pinned: false,
    });
  });
  it('docker image by digest', () => {
    expect(classifyUses(`docker://alpine@sha256:${'a'.repeat(64)}`)).toMatchObject({
      kind: 'docker',
      target: 'docker://alpine',
      pinned: true,
    });
  });
  it.each([
    ['expression', '${{ matrix.action }}'],
    ['empty ref', 'owner/repo@'],
    ['parent path', '../../x@v1'],
    ['no @', 'owner/repo'],
    ['whitespace and shell', 'owner/repo@v1 ; rm -rf'],
    ['number', 42],
    ['null', null],
    ['too many path segments', 'a/b/c/d/e/f/g@v1'],
    ['dot segment', 'owner/./x@v1'],
    ['bad owner', '-owner/repo@v1'],
    ['nested workflows path', 'o/r/.github/workflows/a/b.yml@v1'],
    ['secret-looking ref', 'actions/checkout@ghp_exampleSecretValue'],
  ])('invalid: %s', (_n, raw) => {
    expect(classifyUses(raw)).toEqual({
      kind: 'invalid',
      target: null,
      owner: null,
      repo: null,
      ref: null,
      pinned: false,
    });
  });
});

describe('parseWorkflow', () => {
  it('reads job-level and step-level uses only', () => {
    const text = `
name: x
on:
  workflow_call:
    inputs:
      foo: { type: string }
jobs:
  build:
    uses: example-shared/ci-templates/.github/workflows/build.yml@${A}
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${D}
      - run: echo hi
      - uses: ./local
`;
    const r = parseWorkflow('ci.yml', text);
    expect(r.file).toBe('ci.yml');
    expect(r.unparsable).toBe(false);
    expect(r.refs.map((x) => x.kind)).toEqual(['reusable-workflow', 'action', 'local']);
  });
  it('invalid YAML is unparsable', () => {
    expect(parseWorkflow('a.yml', 'jobs: [:')).toMatchObject({ unparsable: true, refs: [] });
  });
  it('non-object jobs yields no refs', () => {
    expect(parseWorkflow('a.yml', 'jobs: [1, 2]')).toMatchObject({ unparsable: false, refs: [] });
    expect(parseWorkflow('a.yml', 'jobs: hello')).toMatchObject({ unparsable: false, refs: [] });
  });
  it('alias bomb does not hang', () => {
    const lines = ['a0: &a0 [x, x, x, x, x, x, x, x, x, x]'];
    for (let i = 1; i < 10; i++) {
      lines.push(`a${i}: &a${i} [${Array.from({ length: 10 }, () => `*a${i - 1}`).join(', ')}]`);
    }
    lines.push('jobs: {}');
    const t0 = Date.now();
    const r = parseWorkflow('bomb.yml', lines.join('\n'));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.unparsable).toBe(true);
  });
  it('oversized text is unparsable', () => {
    const r = parseWorkflow('big.yml', `# ${'x'.repeat(300 * 1024)}\njobs: {}`);
    expect(r.unparsable).toBe(true);
  });
  it('caps at 200 refs', () => {
    const steps = Array.from({ length: 250 }, (_, i) => `      - uses: actions/checkout@v${i}`);
    const r = parseWorkflow('a.yml', `jobs:\n  j:\n    steps:\n${steps.join('\n')}\n`);
    expect(MAX_REFS_PER_FILE).toBe(200);
    expect(r.refs).toHaveLength(200);
    expect(r.capped).toBe(true);
  });
  it('step name canary never in output', () => {
    for (const canary of CANARIES) {
      const text = `jobs:\n  j:\n    steps:\n      - name: ${JSON.stringify(canary)}\n        uses: actions/checkout@v4\n        run: ${JSON.stringify(canary)}\n        env:\n          X: ${JSON.stringify(canary)}\n`;
      const r = parseWorkflow('a.yml', text);
      expect(r.refs).toHaveLength(1);
      expect(JSON.stringify(r)).not.toContain(canary);
    }
  });
  it('never prints YAML warnings (they quote the untrusted workflow source)', () => {
    const emit = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const out = parseWorkflow(
        'ci.yml',
        'jobs:\n  a:\n    steps:\n      - uses: !custom example/secret-step@v1\n',
      );
      expect(out.unparsable).toBe(false);
      expect(emit).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      emit.mockRestore();
      warn.mockRestore();
    }
  });
  it('an expression in uses is invalid and not copied', () => {
    const r = parseWorkflow('a.yml', 'jobs:\n  j:\n    steps:\n      - uses: ${{ inputs.x }}\n');
    expect(r.refs).toEqual([
      { kind: 'invalid', target: null, owner: null, repo: null, ref: null, pinned: false },
    ]);
  });
});

describe('reusableStatus', () => {
  const target: TargetVersions = {
    latest: 'v2.4.0',
    tags: [
      { name: 'v2.4.0', sha: A },
      { name: 'v2.3.0', sha: B },
      { name: 'v2.1.0', sha: C },
    ],
    visible: true,
  };
  it('current / behind / ahead / major alias', () => {
    expect(reusableStatus('v2.4.0', target).status).toBe('current');
    expect(reusableStatus('v2.1.0', target)).toEqual({ status: 'behind', latest: 'v2.4.0' });
    expect(reusableStatus('v2.5.0-rc.1', target).status).toBe('current');
    expect(reusableStatus('v2', target).status).toBe('current');
    expect(reusableStatus('v1', target).status).toBe('behind');
  });
  it('resolves a SHA to its tag', () => {
    expect(reusableStatus(A, target).status).toBe('current');
    expect(reusableStatus(C, target).status).toBe('behind');
  });
  it('untagged SHA and floating branch', () => {
    expect(reusableStatus('f'.repeat(40), target).status).toBe('untagged');
    expect(reusableStatus('main', target).status).toBe('floating');
  });
  it('not visible or no versions is unknown', () => {
    expect(reusableStatus('v1', { latest: null, tags: null, visible: false }).status).toBe(
      'unknown',
    );
    expect(reusableStatus('v1', { latest: null, tags: [], visible: true }).status).toBe('unknown');
  });
  it('a SHA with tags not read is unknown, never untagged', () => {
    expect(reusableStatus(A, { latest: 'v2.4.0', tags: null, visible: true }).status).toBe(
      'unknown',
    );
  });
  it('a latest over 100 characters is never echoed (defence in depth)', () => {
    const latest = 'v1.0.0-' + 'x'.repeat(120);
    expect(reusableStatus('v1.0.0', { latest, tags: null, visible: true })).toEqual({
      status: 'unknown',
      latest: null,
    });
  });
  it('a pre-release latest (tag fallback) never makes a stable ref behind: unknown', () => {
    const pre: TargetVersions = { latest: 'v2.5.0-rc.1', tags: null, visible: true };
    expect(reusableStatus('v2.4.0', pre)).toEqual({ status: 'unknown', latest: 'v2.5.0-rc.1' });
    expect(reusableStatus('v1', pre).status).toBe('unknown');
    expect(reusableStatus('v2', pre).status).toBe('current');
    expect(reusableStatus('v2.5.0', pre).status).toBe('current');
    // A pre-release ref older than the pre-release latest is still behind.
    expect(reusableStatus('v2.5.0-rc.0', pre).status).toBe('behind');
  });
  it('tag names without a v prefix and a latest from a prefixed tag compare', () => {
    expect(reusableStatus('2.4.0', target).status).toBe('current');
  });
});
