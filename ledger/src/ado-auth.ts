import { readBodyCapped } from '../../shared/http/bounded-read';

/*
 * Azure DevOps sign-in of the bridge (deployments ledger D6). Preferred: workload identity
 * federation, no stored secret. The job asks GitHub for an OIDC token, then Microsoft Entra
 * exchanges it for a token on the Azure DevOps resource. Fallback: a PAT (Environment: read,
 * Build: read). Errors carry a fixed text: no token, assertion or response body.
 */

/** Azure DevOps resource (application) id in Microsoft Entra. */
export const ADO_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 64 * 1024;

export interface FederationOptions {
  tenantId: string;
  clientId: string;
  /** ACTIONS_ID_TOKEN_REQUEST_URL */
  idTokenUrl: string;
  /** ACTIONS_ID_TOKEN_REQUEST_TOKEN */
  idTokenRequestToken: string;
  fetch?: typeof globalThis.fetch;
}

async function json(response: Response): Promise<Record<string, unknown> | null> {
  const bytes = await readBodyCapped(response, MAX_BYTES);
  if (!bytes) return null;
  try {
    const v: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const failed = (step: string, status: number | string) =>
  new Error(`Azure DevOps sign-in failed (${step}: ${status})`);

export async function adoTokenFromFederation(o: FederationOptions): Promise<string> {
  const f = o.fetch ?? globalThis.fetch;
  if (!/^[0-9A-Za-z-]{1,64}$/.test(o.tenantId)) throw failed('tenant id', 'invalid');
  const idUrl = new URL(o.idTokenUrl);
  idUrl.searchParams.set('audience', 'api://AzureADTokenExchange');
  const id = await f(idUrl, {
    headers: { Authorization: `Bearer ${o.idTokenRequestToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!id.ok) throw failed('OIDC token', id.status);
  const assertion = (await json(id))?.value;
  if (typeof assertion !== 'string') throw failed('OIDC token', 'invalid');
  const res = await f(`https://login.microsoftonline.com/${o.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: o.clientId,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
      scope: `${ADO_RESOURCE}/.default`,
    }).toString(),
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw failed('Entra token', res.status);
  const token = (await json(res))?.access_token;
  if (typeof token !== 'string') throw failed('Entra token', 'invalid');
  return token;
}

/** Authorization header for Azure DevOps: Basic for a PAT, Bearer for a federated token. */
export async function adoAuthHeader(o: {
  pat?: string;
  federation?: FederationOptions;
}): Promise<string> {
  if (o.pat) return `Basic ${Buffer.from(`:${o.pat}`).toString('base64')}`;
  if (o.federation) return `Bearer ${await adoTokenFromFederation(o.federation)}`;
  throw new Error('Azure DevOps credentials missing (ADO_PAT or ADO_TENANT_ID + ADO_CLIENT_ID)');
}
