import { execFile } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/*
 * scripts/report-deployment.sh (deployments ledger spec §5.2): the push step for external
 * pipelines. Run against a local fake GitHub: narrowed token, idempotent, never prints the token.
 */
const has = (cmd: string) =>
  new Promise<boolean>((resolve) =>
    execFile('sh', ['-c', `command -v ${cmd}`], (e) => resolve(!e)),
  );

interface Call {
  method: string;
  path: string;
  body: unknown;
}
let server: Server;
let base = '';
let calls: Call[] = [];
let deployments: { id: number; payload: unknown }[] = [];
let createStatus = 201;
const dir = mkdtempSync(join(tmpdir(), 'eph-report-'));
const keyFile = join(dir, 'app.pem');

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => resolve(s));
  });

beforeAll(async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  writeFileSync(keyFile, privateKey.export({ type: 'pkcs1', format: 'pem' }).toString());
  server = createServer(async (req, res) => {
    const raw = await readBody(req);
    const url = new URL(req.url ?? '/', 'http://localhost');
    calls.push({
      method: req.method ?? '',
      path: url.pathname + url.search,
      body: raw ? JSON.parse(raw) : null,
    });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/app/installations/9/access_tokens')
      return send(201, { token: 'ghs_SECRET_TOKEN' });
    if (url.pathname === '/repos/example-org/example-service/deployments' && req.method === 'GET')
      return send(200, deployments);
    if (
      url.pathname === '/repos/example-org/example-service/deployments' &&
      req.method === 'POST'
    ) {
      if (createStatus !== 201) return send(createStatus, { message: 'No ref found' });
      const id = deployments.length + 1;
      deployments.push({ id, payload: (JSON.parse(raw) as { payload: unknown }).payload });
      return send(201, { id });
    }
    if (/\/deployments\/\d+\/statuses$/.test(url.pathname)) return send(201, { id: 1 });
    return send(404, { message: 'Not Found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

function run(): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      'bash',
      ['scripts/report-deployment.sh'],
      {
        env: {
          PATH: process.env.PATH,
          GH_API: base,
          GH_APP_ID: '1',
          GH_INSTALLATION_ID: '9',
          GH_KEY_FILE: keyFile,
          GH_OWNER: 'example-org',
          GH_REPO_NAME: 'example-service',
          SHA: 'a'.repeat(40),
          ENV_NAME: 'prod',
          STATE: 'success',
          RUN_ID: '12345',
          RUN_URL: 'https://dev.azure.com/example-org/example-project/_build/results?buildId=12345',
          ATTEMPT: '1',
          STARTED_AT: '2026-11-04T09:12:00Z',
          FINISHED_AT: '2026-11-04T09:20:31Z',
          VERSION: '0.5.2',
          PRODUCTION: 'true',
        },
      },
      (e, stdout, stderr) =>
        resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out: stdout + stderr }),
    );
  });
}

describe('report-deployment.sh', async () => {
  const ready = (await has('openssl')) && (await has('jq')) && (await has('curl'));

  it.skipIf(!ready)(
    'mints a narrowed token, writes the record once, never prints the token',
    async () => {
      calls = [];
      deployments = [];
      createStatus = 201;
      const first = await run();
      expect(first.code).toBe(0);
      const token = calls.find((c) => c.path === '/app/installations/9/access_tokens')!;
      expect(token.body).toEqual({
        repositories: ['example-service'],
        permissions: { deployments: 'write' },
      });
      const create = calls.find((c) => c.method === 'POST' && c.path.endsWith('/deployments'))!;
      expect(create.body).toMatchObject({
        ref: 'a'.repeat(40),
        environment: 'prod',
        auto_merge: false,
        required_contexts: [],
        transient_environment: false,
        production_environment: true,
        payload: {
          ledger: 1,
          source: 'azure-devops',
          runId: '12345',
          attempt: 1,
          version: '0.5.2',
          finishedAt: '2026-11-04T09:20:31Z',
          declared: false,
          kind: 'deploy',
        },
      });
      expect(
        calls.some(
          (c) => c.path.endsWith('/statuses') && (c.body as { state: string }).state === 'success',
        ),
      ).toBe(true);
      const second = await run();
      expect(second.code).toBe(0);
      expect(second.out).toContain('already recorded');
      expect(
        calls.filter((c) => c.method === 'POST' && c.path.endsWith('/deployments')),
      ).toHaveLength(1);
      expect(first.out + second.out).not.toContain('ghs_SECRET_TOKEN');
    },
  );

  it.skipIf(!ready)('a commit GitHub does not know (422) exits 0 and says so', async () => {
    calls = [];
    deployments = [];
    createStatus = 422;
    const r = await run();
    expect(r.code).toBe(0);
    expect(r.out).toContain('commit not on GitHub');
  });
});
