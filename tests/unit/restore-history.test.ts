import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  candidateArtifacts,
  runIsTrusted,
  type ArtifactLike,
} from '../../collector/src/history/select-artifact';
import { restoreHistory, type RestoreClient } from '../../scripts/restore-history';
import { makeZip } from '../helpers/factories';

const O = { repositoryId: 100, defaultBranch: 'main', currentRunId: 999 };

const art = (id: number, over: Partial<ArtifactLike> = {}): ArtifactLike => ({
  id,
  name: 'hub-history',
  expired: false,
  size_in_bytes: 1000,
  created_at: `2026-01-${String(10 + id).padStart(2, '0')}T00:00:00Z`,
  workflow_run: { id: 500 + id, repository_id: 100, head_repository_id: 100, head_branch: 'main' },
  ...over,
});
const wr = (over: Record<string, unknown>) => ({
  ...(art(1).workflow_run as object),
  ...over,
});

describe('candidateArtifacts', () => {
  it('keeps a main, same-repo, non-expired artifact', () =>
    expect(candidateArtifacts([art(1)], O).map((a) => a.id)).toEqual([1]));
  it('drops expired', () => expect(candidateArtifacts([art(1, { expired: true })], O)).toEqual([]));
  it('drops head_branch "feature/x"', () =>
    expect(
      candidateArtifacts([art(1, { workflow_run: wr({ head_branch: 'feature/x' }) })], O),
    ).toEqual([]));
  it('drops head_repository_id 200 (fork)', () =>
    expect(
      candidateArtifacts([art(1, { workflow_run: wr({ head_repository_id: 200 }) })], O),
    ).toEqual([]));
  it('drops workflow_run.id 999 (current run)', () =>
    expect(candidateArtifacts([art(1, { workflow_run: wr({ id: 999 }) })], O)).toEqual([]));
  it('drops size_in_bytes 5_242_881', () =>
    expect(candidateArtifacts([art(1, { size_in_bytes: 5_242_881 })], O)).toEqual([]));
  it('keeps size_in_bytes 5_242_880', () =>
    expect(candidateArtifacts([art(1, { size_in_bytes: 5_242_880 })], O)).toHaveLength(1));
  it('sorts newest first and returns at most 5 of 7', () => {
    const list = [1, 2, 3, 4, 5, 6, 7].map((i) => art(i));
    expect(candidateArtifacts(list, O).map((a) => a.id)).toEqual([7, 6, 5, 4, 3]);
  });
  it('drops an artifact without workflow_run', () => {
    expect(candidateArtifacts([art(1, { workflow_run: null })], O)).toEqual([]);
    expect(candidateArtifacts([art(1, { workflow_run: undefined })], O)).toEqual([]);
  });
  it('drops another artifact name', () =>
    expect(candidateArtifacts([art(1, { name: 'snapshots' })], O)).toEqual([]));
});

describe('runIsTrusted', () => {
  it('accepts .github/workflows/deploy-pages.yml with event schedule', () =>
    expect(
      runIsTrusted({ id: 1, path: '.github/workflows/deploy-pages.yml', event: 'schedule' }),
    ).toBe(true));
  it('accepts collect-data.yml@refs/heads/main with event workflow_dispatch', () =>
    expect(
      runIsTrusted({
        id: 1,
        path: '.github/workflows/collect-data.yml@refs/heads/main',
        event: 'workflow_dispatch',
      }),
    ).toBe(true));
  it('rejects .github/workflows/ci.yml', () =>
    expect(runIsTrusted({ id: 1, path: '.github/workflows/ci.yml', event: 'push' })).toBe(false));
  it('rejects event pull_request', () =>
    expect(
      runIsTrusted({ id: 1, path: '.github/workflows/deploy-pages.yml', event: 'pull_request' }),
    ).toBe(false));
  it('rejects event pull_request_target', () =>
    expect(
      runIsTrusted({
        id: 1,
        path: '.github/workflows/deploy-pages.yml',
        event: 'pull_request_target',
      }),
    ).toBe(false));
});

const HISTORY_TEXT = '{"kind":"hub-history","note":"héllo"}';
const zipOf = (name = 'history.json', data = HISTORY_TEXT) => makeZip([{ name, data }]);
const buf = (u: Uint8Array): ArrayBuffer =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const httpError = (status: number) => ({
  status,
  message: 'boom - https://docs.github.com/rest',
  response: { headers: {}, data: {} },
});

interface Mock {
  artifacts?: ArtifactLike[];
  runs?: Record<number, { path: string; event: string }>;
  zip?: Uint8Array;
  zips?: Record<number, Uint8Array>;
  pages?: ArtifactLike[][];
  listError?: unknown;
}
function client(m: Mock): {
  c: RestoreClient;
  download: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
} {
  const download = vi.fn(async ({ artifact_id }: { artifact_id: number }) => ({
    data: buf(m.zips?.[artifact_id] ?? m.zip ?? zipOf()),
  }));
  const c = {
    rest: {
      repos: { get: vi.fn(async () => ({ data: { id: 100, default_branch: 'main' } })) },
      actions: {
        listArtifactsForRepo: vi.fn(async ({ page }: { page?: number }) => {
          if (m.listError) throw m.listError;
          if (m.pages) return { data: { artifacts: m.pages[(page ?? 1) - 1] ?? [] } };
          return { data: { artifacts: m.artifacts ?? [] } };
        }),
        getWorkflowRun: vi.fn(async ({ run_id }: { run_id: number }) => ({
          data: {
            id: run_id,
            ...(m.runs?.[run_id] ?? {
              path: '.github/workflows/deploy-pages.yml',
              event: 'schedule',
            }),
          },
        })),
        downloadArtifact: download,
      },
    },
  } as unknown as RestoreClient;
  return {
    c,
    download,
    list: c.rest.actions.listArtifactsForRepo as unknown as ReturnType<typeof vi.fn>,
  };
}
const opts = () => ({
  owner: 'o',
  repo: 'r',
  currentRunId: 999,
  out: join(mkdtempSync(join(tmpdir(), 'rh-')), 'restore'),
});

describe('restoreHistory', () => {
  it('restored: newest trusted candidate downloaded, history.json written to out', async () => {
    const o = opts();
    const { c, download } = client({ artifacts: [art(1), art(2)] });
    expect(await restoreHistory(c, o)).toEqual({ state: 'restored' });
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0]?.[0]).toMatchObject({ artifact_id: 2 });
    expect(readFileSync(join(o.out, 'history.json'), 'utf8')).toBe(HISTORY_TEXT);
  });
  it('skips an untrusted newest run and uses the next trusted one', async () => {
    const o = opts();
    const { c, download } = client({
      artifacts: [art(1), art(2)],
      runs: { 502: { path: '.github/workflows/ci.yml', event: 'push' } },
    });
    expect(await restoreHistory(c, o)).toEqual({ state: 'restored' });
    expect(download.mock.calls[0]?.[0]).toMatchObject({ artifact_id: 1 });
  });
  it('none/no-artifact when the list is empty', async () => {
    expect(await restoreHistory(client({}).c, opts())).toEqual({
      state: 'none',
      reason: 'no-artifact',
    });
  });
  it('none/no-artifact when no candidate run is trusted', async () => {
    const bad = { path: '.github/workflows/ci.yml', event: 'push' };
    const { c, download } = client({ artifacts: [art(1), art(2)], runs: { 501: bad, 502: bad } });
    expect(await restoreHistory(c, opts())).toEqual({ state: 'none', reason: 'no-artifact' });
    expect(download).not.toHaveBeenCalled();
  });
  it('failed/not-authorised on 403 from the artifacts list', async () => {
    const { c } = client({ listError: httpError(403) });
    expect(await restoreHistory(c, opts())).toEqual({ state: 'failed', reason: 'not-authorised' });
  });
  it('failed/bad-archive when the zip lacks history.json', async () => {
    const { c } = client({ artifacts: [art(1)], zip: zipOf('other.json') });
    expect(await restoreHistory(c, opts())).toEqual({ state: 'failed', reason: 'bad-archive' });
  });
  it('failed/bad-archive when the entry is larger than 8_388_608 bytes', async () => {
    const { c } = client({
      artifacts: [art(1)],
      zip: zipOf('history.json', 'a'.repeat(8_388_609)),
    });
    expect(await restoreHistory(c, opts())).toEqual({ state: 'failed', reason: 'bad-archive' });
  });
  it('failed/api-error on a 500', async () => {
    const { c } = client({ listError: httpError(500) });
    expect(await restoreHistory(c, opts())).toEqual({ state: 'failed', reason: 'api-error' });
  });
  it('tries the next trusted artifact after a bad archive', async () => {
    const o = opts();
    const { c, download } = client({
      artifacts: [art(1), art(2)],
      zips: { 2: zipOf('other.json') },
    });
    expect(await restoreHistory(c, o)).toEqual({ state: 'restored' });
    expect(download.mock.calls.map((x) => x[0].artifact_id)).toEqual([2, 1]);
  });
  it('gives up with bad-archive after 3 bad archives', async () => {
    const bad = zipOf('other.json');
    const { c, download } = client({
      artifacts: [1, 2, 3, 4, 5].map((i) => art(i)),
      zip: bad,
    });
    expect(await restoreHistory(c, opts())).toEqual({ state: 'failed', reason: 'bad-archive' });
    expect(download).toHaveBeenCalledTimes(3);
  });
  it('pages past untrusted artifacts to find a trusted one', async () => {
    const fork = (i: number) => art(i, { workflow_run: wr({ head_repository_id: 200 }) });
    const full = Array.from({ length: 100 }, (_, i) => fork(1000 + i));
    const { c, download, list } = client({ pages: [full, full, [art(1)]] });
    expect(await restoreHistory(c, opts())).toEqual({ state: 'restored' });
    expect(list).toHaveBeenCalledTimes(3);
    expect(list.mock.calls[0]?.[0]).toMatchObject({ per_page: 100, page: 1 });
    expect(download.mock.calls[0]?.[0]).toMatchObject({ artifact_id: 1 });
  });
  it('pages at most 5 times', async () => {
    const fork = (i: number) => art(i, { workflow_run: wr({ head_repository_id: 200 }) });
    const full = Array.from({ length: 100 }, (_, i) => fork(1000 + i));
    const { c, list } = client({ pages: [full, full, full, full, full, full, [art(1)]] });
    expect(await restoreHistory(c, opts())).toEqual({ state: 'none', reason: 'no-artifact' });
    expect(list).toHaveBeenCalledTimes(5);
  });
  it('never writes outside --out', async () => {
    const o = opts();
    const { c } = client({ artifacts: [art(1)], zip: zipOf('../evil.json') });
    await restoreHistory(c, o);
    const ok = client({ artifacts: [art(1)] }).c;
    await restoreHistory(ok, o);
    expect(readdirSync(o.out)).toEqual(['history.json']);
    expect(readdirSync(join(o.out, '..')).sort()).toEqual(['restore']);
  });
});

describe('restore-history CLI', () => {
  it('prints no token', () => {
    const token = 'ghp_exampleSecretValue123456789012345678';
    const dir = mkdtempSync(join(tmpdir(), 'rh-cli-'));
    const ghOut = join(dir, 'gh-output');
    writeFileSync(ghOut, '');
    const r = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/restore-history.ts', '--out', join(dir, 'out')],
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
    expect(r.stdout).toContain('History restore: failed (api-error)');
    expect(r.stdout + r.stderr + readFileSync(ghOut, 'utf8')).not.toContain(token);
    expect(readFileSync(ghOut, 'utf8')).toContain('state=failed');
  });
});
