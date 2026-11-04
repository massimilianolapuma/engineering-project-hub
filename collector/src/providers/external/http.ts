import type { ProviderId } from '@model/index';
import { classifyStatus } from '../../../../shared/http/classify';
import { buildTemplateUrl } from '../../../../shared/http/url';
import { DownloadError, readBodyCapped } from '../../util/bounded-fetch';
import { createLimiter } from '../../util/concurrency';
import { fail, ok, type ProviderResult } from '../types';

/** Largest response read from an external provider: 1 MiB. */
export const MAX_EXTERNAL_BYTES = 1_048_576;
/** Concurrent requests per provider. */
const CONCURRENCY = 2;

export interface ExternalClientOptions {
  id: ProviderId;
  baseUrl: string;
  timeoutSeconds: number;
  /** null → every call fails not-authorised without a request. */
  authHeader: string | null;
  /** Injected in tests. */
  fetch?: typeof globalThis.fetch;
}

export interface ExternalClient {
  getJson(
    template: string,
    params: Record<string, string>,
    query?: Record<string, string>,
    opts?: { headers?: Record<string, string>; doubleEncode?: string[] },
  ): Promise<ProviderResult<unknown>>;
}

/**
 * The one audited HTTP client of the external providers. GET only, https only, to the exact
 * host of the configured `baseUrl`: the path comes from a fixed template whose parameters are
 * all encoded, redirects are refused, the response is capped and read as a stream. Errors carry
 * a classification, a status and a fixed message: never the URL, a header or the body.
 */
export function createExternalClient(o: ExternalClientOptions): ExternalClient {
  const limit = createLimiter(CONCURRENCY);
  const base = new URL(o.baseUrl);
  const buildUrl = (
    template: string,
    params: Record<string, string>,
    query: Record<string, string>,
    doubleEncode: readonly string[],
  ): URL => buildTemplateUrl(base, template, params, query, doubleEncode);

  const run = async (
    template: string,
    params: Record<string, string>,
    query: Record<string, string>,
    opts: { headers?: Record<string, string>; doubleEncode?: string[] },
  ): Promise<ProviderResult<unknown>> => {
    if (base.protocol !== 'https:') throw new Error('external host mismatch');
    const url = buildUrl(template, params, query, opts.doubleEncode ?? []);
    if (o.authHeader === null)
      return fail({ classification: 'not-authorised', message: 'credential not set' });

    const extra = Object.fromEntries(
      Object.entries(opts.headers ?? {}).filter(([k]) => k.toLowerCase() !== 'authorization'),
    );
    let response: Response;
    try {
      response = await (o.fetch ?? globalThis.fetch)(url.href, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(o.timeoutSeconds * 1000),
        headers: {
          Accept: 'application/json',
          'User-Agent': 'engineering-project-hub-collector',
          ...extra,
          Authorization: o.authHeader,
        },
      });
    } catch {
      return fail({ classification: 'error', message: 'request failed' });
    }

    const httpStatus = response.status;
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      // The collector keeps its own classes: rejected and too-large stay "error".
      const cls = classifyStatus(httpStatus);
      if (cls === 'not-authorised')
        return fail({ classification: 'not-authorised', httpStatus, message: 'not authorised' });
      if (cls === 'not-found')
        return fail({ classification: 'not-found', httpStatus, message: 'not found' });
      if (cls === 'rate-limited')
        return fail({ classification: 'rate-limited', httpStatus, message: 'rate limited' });
      return fail({ classification: 'error', httpStatus, message: 'request failed' });
    }

    const tooLarge = () =>
      fail<unknown>({ classification: 'invalid-data', message: 'response too large' });
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_EXTERNAL_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      return tooLarge();
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await readBodyCapped(response, MAX_EXTERNAL_BYTES);
    } catch (e) {
      if (e instanceof DownloadError)
        return fail({ classification: 'error', message: 'request failed' });
      throw e;
    }
    if (bytes === null) return tooLarge();
    try {
      return ok(JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown);
    } catch {
      return fail({ classification: 'invalid-data', message: 'invalid response' });
    }
  };

  return {
    getJson: (template, params, query = {}, opts = {}) =>
      limit(() => run(template, params, query, opts)),
  };
}
