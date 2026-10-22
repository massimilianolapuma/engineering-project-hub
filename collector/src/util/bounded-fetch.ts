/**
 * Bounded download of a short-lived URL handed out by an API (e.g. the SBOM download link).
 * https only, an allow-listed host, no credentials, no redirects, a timeout and a streaming
 * byte cap: the body is never read past `maxBytes + 1` bytes.
 */
export class DownloadError extends Error {
  override readonly name = 'DownloadError';
  constructor(readonly kind: 'host' | 'too-large' | 'http' | 'network') {
    super(kind);
  }
}

/** Exact host, or a `.`-suffix match ("objects.githubusercontent.com" for "githubusercontent.com"). */
export function hostAllowed(host: string, suffixes: readonly string[]): boolean {
  const h = host.toLowerCase();
  return suffixes.some((s) => h === s || h.endsWith(`.${s}`));
}

export interface DownloadOptions {
  allowedHostSuffixes: readonly string[];
  maxBytes: number;
  timeoutMs: number;
  /** Injected in tests. */
  fetch?: typeof globalThis.fetch;
}

export async function downloadBounded(url: string, opts: DownloadOptions): Promise<string> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new DownloadError('host');
  }
  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    !hostAllowed(target.hostname, opts.allowedHostSuffixes)
  )
    throw new DownloadError('host');

  let response: Response;
  try {
    response = await (opts.fetch ?? globalThis.fetch)(target.href, {
      method: 'GET',
      // The link is pre-signed: it must never receive the API credential.
      headers: { 'User-Agent': 'engineering-project-hub-collector' },
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch {
    throw new DownloadError('network');
  }
  if (!response.ok) throw new DownloadError('http');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > opts.maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new DownloadError('too-large');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > opts.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new DownloadError('too-large');
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof DownloadError) throw e;
    throw new DownloadError('network');
  }
  return Buffer.concat(chunks).toString('utf8');
}
