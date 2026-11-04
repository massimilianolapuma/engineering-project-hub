/**
 * npm run deployments:bridge -- --map <file> [--mode dry-run|write] [--since-days 7]
 * Azure DevOps → GitHub Deployments (ADR 0015). Writes only with --mode write AND the repository
 * variable HUB_DEPLOYMENTS_BRIDGE=write. Prints a summary; never a token, a key or a payload.
 *
 * Environment: LEDGER_APP_ID, LEDGER_APP_PRIVATE_KEY (deployment App, writes),
 * GH_APP_ID, GH_APP_PRIVATE_KEY (hub App, reads), and either ADO_TENANT_ID + ADO_CLIENT_ID
 * (federation; ACTIONS_ID_TOKEN_REQUEST_URL/TOKEN from the job) or ADO_PAT.
 */
import { appendFile, readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { DeploymentsBridgeMapSchema } from '@model/index';
import { createAdoClient } from './ado';
import { adoAuthHeader } from './ado-auth';
import { runBridge } from './bridge';
import { createAppClients } from './github';
import { resolveLedgerMode } from './mode';

const { values } = parseArgs({
  options: {
    map: { type: 'string', default: 'config/deployments-bridge.yaml' },
    mode: { type: 'string', default: 'dry-run' },
    'since-days': { type: 'string', default: '7' },
  },
});

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing environment variable ${name}`);
  return v;
}

async function main(): Promise<number> {
  const sinceDays = Number(values['since-days']);
  if (!Number.isInteger(sinceDays) || sinceDays < 1 || sinceDays > 90)
    throw new Error('--since-days must be an integer between 1 and 90');
  const map = DeploymentsBridgeMapSchema.parse(parse(await readFile(values.map, 'utf8')));
  const env = process.env;
  const authHeader = await adoAuthHeader(
    env.ADO_PAT
      ? { pat: env.ADO_PAT }
      : {
          federation: {
            tenantId: required('ADO_TENANT_ID'),
            clientId: required('ADO_CLIENT_ID'),
            idTokenUrl: required('ACTIONS_ID_TOKEN_REQUEST_URL'),
            idTokenRequestToken: required('ACTIONS_ID_TOKEN_REQUEST_TOKEN'),
          },
        },
  );
  const apps = createAppClients({
    writeAppId: required('LEDGER_APP_ID'),
    writeKey: required('LEDGER_APP_PRIVATE_KEY'),
    readAppId: required('GH_APP_ID'),
    readKey: required('GH_APP_PRIVATE_KEY'),
  });
  const result = await runBridge({
    map,
    ado: createAdoClient({ authHeader }),
    writer: apps.writer,
    reader: apps.reader,
    mode: resolveLedgerMode({ input: values.mode, variable: env.HUB_DEPLOYMENTS_BRIDGE }),
    now: new Date(),
    sinceDays,
  });
  console.log(result.summary);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, result.summary);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    // Only our own fixed messages are printed: never a request, a header or a response body.
    const message =
      e instanceof Error && /^(missing|--since|Azure DevOps)/.test(e.message)
        ? e.message
        : 'deployments bridge failed';
    console.error(message);
    process.exit(1);
  });
