import { LedgerRecordSchema, type LedgerRecord } from '@model/index';
import { normaliseVersion } from '../../shared/semver';
import type { LedgerReader } from './github';

/*
 * Declared ledger record (deployments ledger spec §5.4): a deploy no system can report, entered
 * by a person through a protected workflow. Always `source: manual`, `declared: true`. A version
 * resolves to the commit of its tag; a missing tag or an unknown commit refuses the record.
 */

export interface DeclareInput {
  repository: string;
  environment: string;
  sha?: string;
  version?: string;
  tagPrefix: string;
  state: 'success' | 'failure';
  finishedAt: string;
  note: string;
  runId: string;
  runUrl: string;
  production: boolean;
}

export type DeclareRefusal =
  'tag-missing' | 'no-ref' | 'commit-not-on-github' | 'commit-unverified';

export async function buildDeclaredRecord(
  i: DeclareInput,
  reader: LedgerReader,
): Promise<LedgerRecord | { refused: DeclareRefusal }> {
  const version = i.version ? (normaliseVersion(i.version) ?? undefined) : undefined;
  let sha: string;
  if (i.sha) {
    const known = await reader.commitExists(i.repository, i.sha);
    if (known === 'unknown') return { refused: 'commit-unverified' };
    if (!known) return { refused: 'commit-not-on-github' };
    sha = i.sha;
  } else if (version) {
    const tagged = await reader.tagCommit(i.repository, `${i.tagPrefix}${version}`);
    if (!tagged) return { refused: 'tag-missing' };
    sha = tagged;
  } else return { refused: 'no-ref' };
  return LedgerRecordSchema.parse({
    repository: i.repository,
    environment: i.environment,
    sha,
    production: i.production,
    state: i.state,
    description: (i.note.trim() || 'Declared deploy').replace(/[\r\n]+/g, ' ').slice(0, 140),
    payload: {
      ledger: 1,
      source: 'manual',
      runId: i.runId,
      runUrl: i.runUrl,
      attempt: 1,
      ...(version ? { version } : {}),
      finishedAt: i.finishedAt,
      declared: true,
      kind: 'deploy',
    },
  });
}
