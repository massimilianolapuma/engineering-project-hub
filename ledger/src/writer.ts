import { LedgerPayloadSchema, ledgerKey, type LedgerRecord } from '@model/index';
import type { DeploymentRequest, LedgerGitHub } from './github';
import type { LedgerMode } from './mode';

/*
 * Idempotent ledger writer (spec §5.1, D4). A deploy is identified by (source, run, attempt,
 * environment): writing it again changes nothing; a record without a final status gets it.
 * Dry-run reads but never posts.
 */

export type WriteOutcome = 'written' | 'exists' | 'status-added' | 'would-write';

const FINAL = new Set(['success', 'failure', 'error']);

export function deploymentRequest(r: LedgerRecord): DeploymentRequest {
  return {
    ref: r.sha,
    environment: r.environment,
    auto_merge: false,
    required_contexts: [],
    transient_environment: false,
    production_environment: r.production,
    description: r.description,
    payload: r.payload,
  };
}

export async function writeRecord(
  gh: LedgerGitHub,
  r: LedgerRecord,
  mode: LedgerMode,
): Promise<{ outcome: WriteOutcome; id?: number }> {
  const key = ledgerKey(r);
  const existing = await gh.listDeployments(r.repository, r.sha, r.environment);
  const match = existing.find((d) => {
    const p = LedgerPayloadSchema.safeParse(d.payload);
    return p.success && ledgerKey({ environment: r.environment, payload: p.data }) === key;
  });
  if (match) {
    if (match.statuses.some((s) => FINAL.has(s))) return { outcome: 'exists', id: match.id };
    if (mode.mode !== 'write') return { outcome: 'would-write', id: match.id };
    await gh.createStatus(r.repository, match.id, r.state, r.payload.runUrl);
    return { outcome: 'status-added', id: match.id };
  }
  if (mode.mode !== 'write') return { outcome: 'would-write' };
  const id = await gh.createDeployment(r.repository, deploymentRequest(r));
  await gh.createStatus(r.repository, id, r.state, r.payload.runUrl);
  return { outcome: 'written', id };
}
