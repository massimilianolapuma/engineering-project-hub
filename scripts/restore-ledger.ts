/**
 * Restores the notification ledger (ledger.json) from this repository's own newest trusted
 * "hub-notify-ledger" artifact, including an earlier attempt of the current run (a re-run after a
 * successful send must not post again). Only the workflow GITHUB_TOKEN (actions: read) is used.
 * Writes state=restored|none|failed to $GITHUB_OUTPUT and always exits 0: the notifier decides
 * (a failed restore in send mode means nothing is sent).
 * Usage: tsx scripts/restore-ledger.ts --out <dir>
 */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { workflowPathFromRef, type RestoreOutcome } from '../collector/src/history/select-artifact';
import { createRestoreClient, restoreArtifactFile } from './restore-history';

export const LEDGER_ARTIFACT = 'hub-notify-ledger';
const LEDGER_FILE = 'ledger.json';
const LEDGER_MAX_BYTES = 1_048_576;

function report(outcome: RestoreOutcome): void {
  const reason = 'reason' in outcome ? outcome.reason : '';
  const ghOutput = process.env.GITHUB_OUTPUT;
  if (ghOutput) appendFileSync(ghOutput, `state=${outcome.state}\nreason=${reason}\n`);
  console.log(`Ledger restore: ${outcome.state}${reason ? ` (${reason})` : ''}`);
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  const out = i >= 0 ? args[i + 1] : undefined;
  const token = process.env.GITHUB_TOKEN ?? '';
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
  const currentRunId = Number(process.env.GITHUB_RUN_ID);
  let outcome: RestoreOutcome;
  if (!out || !token || !owner || !repo || !Number.isInteger(currentRunId)) {
    outcome = { state: 'failed', reason: 'api-error' };
  } else {
    const caller = workflowPathFromRef(process.env.GITHUB_WORKFLOW_REF);
    outcome = await restoreArtifactFile(createRestoreClient(token, process.env.GITHUB_API_URL), {
      owner,
      repo,
      currentRunId,
      out,
      trustedPaths: caller ? [caller] : [],
      artifactName: LEDGER_ARTIFACT,
      fileName: LEDGER_FILE,
      maxBytes: LEDGER_MAX_BYTES,
      includeCurrentRun: true,
    });
  }
  report(outcome);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => report({ state: 'failed', reason: 'api-error' }));
}
