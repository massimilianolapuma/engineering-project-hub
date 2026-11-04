import { describe, expect, it } from 'vitest';
import { createAdoClient } from '../../ledger/src/ado';
import { adoAuthHeader, adoTokenFromFederation } from '../../ledger/src/ado-auth';

/*
 * Azure DevOps authentication of the bridge (spec §5.3, D6): workload identity federation from
 * GitHub Actions (no stored secret), PAT fallback. Never logs the assertion or the token.
 */
describe('adoTokenFromFederation', () => {
  it('exchanges the GitHub OIDC token with Entra for an Azure DevOps token', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.startsWith('https://token.actions.example/'))
        return new Response(JSON.stringify({ value: 'gh-oidc-jwt' }), { status: 200 });
      if (url === 'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token')
        return new Response(JSON.stringify({ access_token: 'ado-token', expires_in: 3600 }), {
          status: 200,
        });
      return new Response('{}', { status: 404 });
    };
    const token = await adoTokenFromFederation({
      tenantId: 'tenant-1',
      clientId: 'client-1',
      idTokenUrl: 'https://token.actions.example/?x=1',
      idTokenRequestToken: 'req-token',
      fetch: fetch as typeof globalThis.fetch,
    });
    expect(token).toBe('ado-token');
    expect(new URL(calls[0]!.url).searchParams.get('audience')).toBe('api://AzureADTokenExchange');
    const form = new URLSearchParams(String(calls[1]!.init?.body));
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'client_credentials',
      client_id: 'client-1',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: 'gh-oidc-jwt',
      scope: '499b84ac-1321-427f-aa17-267ca6975798/.default',
    });
  });

  it('fails with a fixed message that carries no token', async () => {
    const fetch = async () =>
      new Response('{"error":"invalid_client","secret":"x"}', { status: 401 });
    await expect(
      adoTokenFromFederation({
        tenantId: 't',
        clientId: 'c',
        idTokenUrl: 'https://token.actions.example/',
        idTokenRequestToken: 'r',
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).rejects.toThrow(/^Azure DevOps sign-in failed \(OIDC token: 401\)$/);
  });
});

describe('adoAuthHeader', () => {
  it('uses Basic with an empty user for a PAT', async () => {
    expect(await adoAuthHeader({ pat: 'p' })).toBe(`Basic ${Buffer.from(':p').toString('base64')}`);
  });
});

describe('createAdoClient', () => {
  it('maps environment deployment records and the run commit (api-version 7.1)', async () => {
    const seen: string[] = [];
    const fetch = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      seen.push(url.pathname + url.search);
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.pathname.endsWith('/_apis/distributedtask/environments'))
        return ok({ count: 1, value: [{ id: 42, name: 'Prod' }] });
      if (url.pathname.endsWith('/environments/42/environmentdeploymentrecords'))
        return ok({
          count: 1,
          value: [
            {
              id: 9001,
              result: 'succeeded',
              startTime: '2026-02-20T09:00:00Z',
              finishTime: '2026-02-20T09:10:00Z',
              stageAttempt: 2,
              stageName: 'Deploy_Prod',
              jobName: 'app',
              definition: { id: 7, name: 'deploy' },
              owner: { id: 345, name: '20260220.1' },
            },
          ],
        });
      if (url.pathname.endsWith('/_apis/pipelines/7/runs/345'))
        return ok({ resources: { repositories: { self: { version: 'c'.repeat(40) } } } });
      return new Response('{}', { status: 404 });
    };
    const ado = createAdoClient({ authHeader: 'Basic x', fetch: fetch as typeof globalThis.fetch });
    expect(await ado.environmentId('example-org', 'example-project', 'prod')).toBe(42);
    expect(await ado.deploymentRecords('example-org', 'example-project', 42)).toEqual([
      {
        id: 9001,
        result: 'succeeded',
        startTime: '2026-02-20T09:00:00Z',
        finishTime: '2026-02-20T09:10:00Z',
        pipelineId: 7,
        runId: 345,
        attempt: 2,
        stage: 'Deploy_Prod',
        job: 'app',
        runUrl: 'https://dev.azure.com/example-org/example-project/_build/results?buildId=345',
      },
    ]);
    expect(await ado.runCommit('example-org', 'example-project', 7, 345, 'self')).toBe(
      'c'.repeat(40),
    );
    expect(await ado.runCommit('example-org', 'example-project', 7, 345, 'mirror')).toBeNull();
    expect(seen.every((s) => s.includes('api-version=7.1'))).toBe(true);
  });
});
