import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { LedgerRecord } from '@model/index';
import { createAppClients, type LedgerGitHub } from '../../ledger/src/github';
import { resolveLedgerMode } from '../../ledger/src/mode';
import { renderSummary } from '../../ledger/src/summary';
import { writeRecord } from '../../ledger/src/writer';

/*
 * Ledger writer (deployments ledger spec §5.1, D4, D9): idempotent, dry-run unless both opt-ins
 * say write, tokens narrowed to one repository and to deployments: write.
 */
const record = (attempt = 1): LedgerRecord => ({
  repository: 'example-org/example-service',
  environment: 'prod',
  sha: 'a'.repeat(40),
  production: true,
  state: 'success',
  description: 'ADO run 12345',
  payload: {
    ledger: 1,
    source: 'azure-devops',
    runId: '12345',
    runUrl: 'https://dev.azure.com/example-org/example-project/_build/results?buildId=12345',
    attempt,
    finishedAt: '2026-11-04T09:20:31Z',
    declared: false,
    kind: 'deploy',
  },
});

function memoryGitHub() {
  const deployments: { id: number; payload: unknown; statuses: string[]; req: unknown }[] = [];
  const calls = { create: 0, status: 0 };
  const gh: LedgerGitHub = {
    async listDeployments() {
      return deployments.map(({ id, payload, statuses }) => ({ id, payload, statuses }));
    },
    async createDeployment(_repo, req) {
      calls.create++;
      const id = deployments.length + 1;
      deployments.push({ id, payload: req.payload, statuses: [], req });
      return id;
    },
    async createStatus(_repo, id, state) {
      calls.status++;
      deployments.find((d) => d.id === id)!.statuses.unshift(state);
    },
  };
  return { gh, deployments, calls };
}

describe('writeRecord', () => {
  it('writes once: the same record a second time already exists', async () => {
    const m = memoryGitHub();
    expect((await writeRecord(m.gh, record(), { mode: 'write' })).outcome).toBe('written');
    expect((await writeRecord(m.gh, record(), { mode: 'write' })).outcome).toBe('exists');
    expect(m.calls.create).toBe(1);
  });

  it('a retried stage (attempt 2) is a new record', async () => {
    const m = memoryGitHub();
    await writeRecord(m.gh, record(1), { mode: 'write' });
    expect((await writeRecord(m.gh, record(2), { mode: 'write' })).outcome).toBe('written');
    expect(m.calls.create).toBe(2);
  });

  it('adds the final status to a record that has none', async () => {
    const m = memoryGitHub();
    m.deployments.push({ id: 1, payload: record().payload, statuses: [], req: null });
    expect((await writeRecord(m.gh, record(), { mode: 'write' })).outcome).toBe('status-added');
    expect(m.deployments[0]!.statuses).toEqual(['success']);
  });

  it('dry-run writes nothing', async () => {
    const m = memoryGitHub();
    const r = await writeRecord(m.gh, record(), { mode: 'dry-run', reason: 'mode-input' });
    expect(r.outcome).toBe('would-write');
    expect(m.calls).toEqual({ create: 0, status: 0 });
  });

  it('sends the record format of spec §5.1', async () => {
    const m = memoryGitHub();
    await writeRecord(m.gh, record(), { mode: 'write' });
    expect(m.deployments[0]!.req).toEqual({
      ref: 'a'.repeat(40),
      environment: 'prod',
      auto_merge: false,
      required_contexts: [],
      transient_environment: false,
      production_environment: true,
      description: 'ADO run 12345',
      payload: record().payload,
    });
  });
});

describe('resolveLedgerMode', () => {
  it('writes only when both the input and the repository variable say write', () => {
    expect(resolveLedgerMode({ input: 'write', variable: undefined })).toEqual({
      mode: 'dry-run',
      reason: 'mode-variable',
    });
    expect(resolveLedgerMode({ input: undefined, variable: 'write' })).toEqual({
      mode: 'dry-run',
      reason: 'mode-input',
    });
    expect(resolveLedgerMode({ input: 'write', variable: 'write' })).toEqual({ mode: 'write' });
  });
});

describe('createAppClients', () => {
  it('asks for a token narrowed to one repository and to deployments: write', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    const bodies: unknown[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.pathname === '/repos/example-org/example-service/installation')
        return json(200, { id: 9 });
      if (url.pathname === '/app/installations/9/access_tokens') {
        const raw =
          typeof init?.body === 'string'
            ? init.body
            : input instanceof Request
              ? await input.text()
              : await new Response(init?.body as BodyInit).text();
        bodies.push(JSON.parse(raw));
        return json(201, {
          token: 'ghs_x',
          expires_at: '2099-01-01T00:00:00Z',
          permissions: {},
          repository_selection: 'selected',
        });
      }
      if (url.pathname === '/repos/example-org/example-service/deployments') return json(200, []);
      return json(404, { message: 'Not Found' });
    };
    const clients = createAppClients({
      writeAppId: '1',
      writeKey: pem,
      fetch: fetch as typeof globalThis.fetch,
    });
    const gh = await clients.writer('example-org/example-service');
    await gh.listDeployments('example-org/example-service', 'a'.repeat(40), 'prod');
    expect(bodies[0]).toEqual({
      repositories: ['example-service'],
      permissions: { deployments: 'write' },
    });
  });
});

describe('renderSummary', () => {
  it('lists environments with read, written and skipped reasons', () => {
    const text = renderSummary([
      {
        repository: 'example-org/example-service',
        environment: 'prod',
        read: 4,
        written: 2,
        skipped: [{ reason: 'not-completed', count: 2 }],
      },
    ]);
    expect(text).toContain('| example-org/example-service | prod | 4 | 2 | not-completed: 2 |');
  });

  it('escapes backslashes before pipes, so a cell cannot break out of its column', () => {
    const text = renderSummary([
      { repository: 'a/b', environment: 'x\\|y', read: 0, written: 0, skipped: [] },
    ]);
    expect(text).toContain('| a/b | x\\\\\\|y | 0 | 0 | – |');
  });
});
