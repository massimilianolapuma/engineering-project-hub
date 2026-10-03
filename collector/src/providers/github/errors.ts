import type { ProviderError } from '../types';

interface ErrorLike {
  status?: number;
  message?: string;
  name?: string;
  response?: { headers?: Record<string, string | number | undefined>; data?: unknown };
}

function apiMessage(e: ErrorLike): string {
  const data = e.response?.data;
  if (
    data &&
    typeof data === 'object' &&
    'message' in data &&
    typeof (data as { message: unknown }).message === 'string'
  ) {
    return (data as { message: string }).message;
  }
  // RequestError messages are "<API message> - <docs url>"; keep the first part only.
  return (e.message ?? '').split(' - ')[0] ?? '';
}

const NOT_CONFIGURED =
  /(not enabled|is disabled|are disabled|must be enabled|advanced security|no analysis found|not available for this repository)/i;

/**
 * Classifies a GitHub API error without ever reading request data (which holds the
 * Authorization header). Rules:
 * - 429, or 403 with exhausted rate limit / retry-after → rate-limited
 * - 403 / 404 whose message says the feature is disabled → not-configured
 * - other 401 / 403 → not-authorised (never "no alerts")
 * - other 404 → not-found (ambiguous for security endpoints: the collector shows "unknown")
 * - status 0 (InvalidData) → invalid-data; everything else (5xx, network) → error
 */
export function classifyGitHubError(err: unknown): ProviderError {
  const e = (err ?? {}) as ErrorLike;
  const status = typeof e.status === 'number' ? e.status : undefined;
  const headers = e.response?.headers ?? {};
  const message = apiMessage(e).slice(0, 200);
  const base = { ...(status ? { httpStatus: status } : {}), ...(message ? { message } : {}) };

  if (e.name === 'InvalidData' || status === 0) return { classification: 'invalid-data', message };
  if (
    status === 429 ||
    ((status === 403 || status === 401) &&
      (String(headers['x-ratelimit-remaining'] ?? '') === '0' ||
        headers['retry-after'] !== undefined ||
        /rate limit/i.test(message)))
  ) {
    return { classification: 'rate-limited', ...base };
  }
  if ((status === 403 || status === 404) && NOT_CONFIGURED.test(message))
    return { classification: 'not-configured', ...base };
  if (status === 401 || status === 403) return { classification: 'not-authorised', ...base };
  if (status === 404 || status === 410) return { classification: 'not-found', ...base };
  return { classification: 'error', ...base, ...(status ? {} : { message: e.name ?? 'Error' }) };
}
