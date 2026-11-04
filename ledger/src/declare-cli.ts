/**
 * npm run deployments:declare -- --repository owner/repo --environment prod
 *   (--sha <commit> | --version <x.y.z> [--tag-prefix v]) --result success|failure
 *   [--date <ISO 8601>] [--note <text>] [--production] [--mode dry-run|write]
 * Declared ledger record (ADR 0015, spec §5.4). Runs in the protected `deployments-declare`
 * environment of the calling repository. Writes only with --mode write AND
 * HUB_DEPLOYMENTS_BRIDGE=write. Environment: LEDGER_APP_ID, LEDGER_APP_PRIVATE_KEY, GH_APP_ID,
 * GH_APP_PRIVATE_KEY, and the job's GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID.
 */
import { appendFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { buildDeclaredRecord } from './declare';
import { createAppClients } from './github';
import { resolveLedgerMode } from './mode';
import { renderSummary } from './summary';
import { writeRecord } from './writer';

const { values } = parseArgs({
  options: {
    repository: { type: 'string' },
    environment: { type: 'string' },
    sha: { type: 'string' },
    version: { type: 'string' },
    'tag-prefix': { type: 'string', default: 'v' },
    result: { type: 'string' },
    date: { type: 'string' },
    note: { type: 'string', default: '' },
    production: { type: 'boolean', default: false },
    mode: { type: 'string', default: 'dry-run' },
  },
});

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing environment variable ${name}`);
  return v;
}

async function main(): Promise<number> {
  const env = process.env;
  const repository = values.repository ?? '';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error('missing or invalid --repository (owner/repo)');
  if (values.result !== 'success' && values.result !== 'failure')
    throw new Error('missing or invalid --result (success or failure)');
  const finishedAt = values.date ? new Date(values.date) : new Date();
  if (Number.isNaN(finishedAt.getTime())) throw new Error('missing or invalid --date');
  const runId = required('GITHUB_RUN_ID');
  const apps = createAppClients({
    writeAppId: required('LEDGER_APP_ID'),
    writeKey: required('LEDGER_APP_PRIVATE_KEY'),
    readAppId: required('GH_APP_ID'),
    readKey: required('GH_APP_PRIVATE_KEY'),
  });
  const record = await buildDeclaredRecord(
    {
      repository,
      environment: values.environment ?? '',
      sha: values.sha || undefined,
      version: values.version || undefined,
      tagPrefix: values['tag-prefix'],
      state: values.result,
      finishedAt: finishedAt.toISOString(),
      note: values.note,
      runId,
      runUrl: `${required('GITHUB_SERVER_URL')}/${required('GITHUB_REPOSITORY')}/actions/runs/${runId}`,
      production: values.production,
    },
    await apps.reader(repository),
  );
  const mode = resolveLedgerMode({ input: values.mode, variable: env.HUB_DEPLOYMENTS_BRIDGE });
  let summary: string;
  if ('refused' in record) {
    summary = `### Declared deploy refused: ${record.refused}\n`;
  } else {
    const { outcome } = await writeRecord(await apps.writer(repository), record, mode);
    summary = renderSummary(
      [
        {
          repository,
          environment: record.environment,
          read: 1,
          written: outcome === 'exists' ? 0 : 1,
          skipped: outcome === 'exists' ? [{ reason: 'already-recorded', count: 1 }] : [],
        },
      ],
      `### Declared deploy: ${mode.mode === 'write' ? outcome : `dry-run (${mode.reason})`}\n`,
    );
  }
  console.log(summary);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary);
  return 'refused' in record ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    const message =
      e instanceof Error && /^missing/.test(e.message) ? e.message : 'declared deploy failed';
    console.error(message);
    process.exit(1);
  });
