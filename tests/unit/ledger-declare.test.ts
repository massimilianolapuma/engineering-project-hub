import { describe, expect, it } from 'vitest';
import { buildDeclaredRecord } from '../../ledger/src/declare';
import type { LedgerReader } from '../../ledger/src/github';

/*
 * Declared ledger records (deployments ledger spec §5.4): a manual record when no system is
 * readable, always marked declared; a version resolves to its tag commit or is refused.
 */
const TAG_SHA = 'd'.repeat(40);
const reader = (o: { tag?: string | null; known?: boolean } = {}): LedgerReader => ({
  commitExists: async () => o.known ?? true,
  fileAt: async () => null,
  tagCommit: async (_r, tag) => (tag === 'v0.5.2' ? (o.tag === undefined ? TAG_SHA : o.tag) : null),
});
const input = {
  repository: 'example-org/example-service',
  environment: 'prod',
  tagPrefix: 'v',
  state: 'success' as const,
  finishedAt: '2026-11-04T10:00:00Z',
  note: 'Deployed by the customer on site',
  runId: '555',
  runUrl: 'https://github.com/example-org/hub-deploy/actions/runs/555',
  production: true,
};

describe('buildDeclaredRecord', () => {
  it('resolves a version to the commit of its tag and marks the record declared', async () => {
    const r = await buildDeclaredRecord({ ...input, version: '0.5.2' }, reader());
    expect(r).toMatchObject({
      sha: TAG_SHA,
      environment: 'prod',
      state: 'success',
      description: 'Deployed by the customer on site',
      payload: {
        source: 'manual',
        declared: true,
        version: '0.5.2',
        runId: '555',
        finishedAt: '2026-11-04T10:00:00Z',
      },
    });
  });

  it('refuses a version whose tag does not exist', async () => {
    expect(
      await buildDeclaredRecord({ ...input, version: '0.5.2' }, reader({ tag: null })),
    ).toEqual({
      refused: 'tag-missing',
    });
  });

  it('accepts a commit GitHub knows, refuses one it does not', async () => {
    const sha = 'e'.repeat(40);
    expect(await buildDeclaredRecord({ ...input, sha }, reader())).toMatchObject({ sha });
    expect(await buildDeclaredRecord({ ...input, sha }, reader({ known: false }))).toEqual({
      refused: 'commit-not-on-github',
    });
  });

  it('refuses a record with neither commit nor version', async () => {
    expect(await buildDeclaredRecord(input, reader())).toEqual({ refused: 'no-ref' });
  });
});
