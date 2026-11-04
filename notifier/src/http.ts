import { classifyStatus, type HttpClass } from '../../shared/http/classify';
import { hostAllowed, readBodyCapped } from '../../shared/http/bounded-read';

/*
 * The notifier's only outward request (spec §5.5.5, ADR 0013): one POST to an allowed Teams
 * Workflows host. Checks happen before any request; redirects are refused; the response is read
 * up to 64 KiB and discarded; there is no retry (POST is not idempotent). Nothing is logged and
 * no URL, header or body ever leaves this function.
 */

const MAX_RESPONSE_BYTES = 65_536;

export type PostOutcome =
  { outcome: 'sent' } | { outcome: 'refused'; reason: 'host-not-allowed' } | { outcome: HttpClass };

export interface PostOptions {
  url: string;
  body: string;
  allowedHostSuffixes: readonly string[];
  timeoutSeconds?: number;
  /** Injected in tests. */
  fetch?: typeof globalThis.fetch;
}

export async function postOnce(o: PostOptions): Promise<PostOutcome> {
  let target: URL;
  try {
    target = new URL(o.url);
  } catch {
    return { outcome: 'refused', reason: 'host-not-allowed' };
  }
  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    !hostAllowed(target.hostname, o.allowedHostSuffixes)
  )
    return { outcome: 'refused', reason: 'host-not-allowed' };

  let response: Response;
  try {
    response = await (o.fetch ?? globalThis.fetch)(target.href, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout((o.timeoutSeconds ?? 20) * 1000),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'engineering-project-hub-notifier',
      },
      body: o.body,
    });
  } catch {
    return { outcome: 'error' };
  }
  try {
    await readBodyCapped(response, MAX_RESPONSE_BYTES);
  } catch {
    // The response is only drained, never used: a read failure does not change the outcome.
  }
  if (response.status >= 200 && response.status < 300) return { outcome: 'sent' };
  return { outcome: classifyStatus(response.status) };
}
