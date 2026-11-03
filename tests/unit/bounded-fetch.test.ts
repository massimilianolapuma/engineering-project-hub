import { describe, expect, it } from 'vitest';
import { DownloadError, downloadBounded } from '../../collector/src/util/bounded-fetch';

interface Seen {
  url: string;
  init: RequestInit | undefined;
}

function fetchOf(
  body: string | (() => ReadableStream<Uint8Array>),
  seen: Seen[] = [],
  status = 200,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), init });
    const stream = typeof body === 'string' ? body : body();
    return new Response(stream, { status });
  }) as typeof fetch;
}

const base = { allowedHostSuffixes: ['githubusercontent.com', 'github.com'], timeoutMs: 1000 };
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof DownloadError ? e.kind : 'other';
  }
};

describe('downloadBounded', () => {
  it('rejects http:', async () => {
    const seen: Seen[] = [];
    const p = downloadBounded('http://objects.githubusercontent.com/x', {
      ...base,
      maxBytes: 100,
      fetch: fetchOf('x', seen),
    });
    expect(await code(p)).toBe('host');
    expect(seen).toHaveLength(0);
  });

  it('rejects host evil.com and githubusercontent.com.evil.com without a request', async () => {
    for (const url of [
      'https://evil.com/x',
      'https://githubusercontent.com.evil.com/x',
      'https://evilgithub.com/x',
      'https://user:pw@objects.githubusercontent.com/x',
      'not a url',
    ]) {
      const seen: Seen[] = [];
      const p = downloadBounded(url, { ...base, maxBytes: 100, fetch: fetchOf('x', seen) });
      expect(await code(p), url).toBe('host');
      expect(seen).toHaveLength(0);
    }
  });

  it('accepts objects.githubusercontent.com and github.com', async () => {
    for (const host of ['objects.githubusercontent.com', 'github.com']) {
      const text = await downloadBounded(`https://${host}/sbom.json?sig=abc`, {
        ...base,
        maxBytes: 100,
        fetch: fetchOf('{"a":1}'),
      });
      expect(text).toBe('{"a":1}');
    }
  });

  it('never sends an Authorization header', async () => {
    const seen: Seen[] = [];
    await downloadBounded('https://objects.githubusercontent.com/x', {
      ...base,
      maxBytes: 100,
      fetch: fetchOf('x', seen),
    });
    const headers = new Headers(seen[0]!.init?.headers);
    expect(headers.has('authorization')).toBe(false);
    expect(seen[0]!.init?.method).toBe('GET');
  });

  it("passes redirect: 'error' and a timeout signal", async () => {
    const seen: Seen[] = [];
    await downloadBounded('https://objects.githubusercontent.com/x', {
      ...base,
      maxBytes: 100,
      fetch: fetchOf('x', seen),
    });
    expect(seen[0]!.init?.redirect).toBe('error');
    expect(seen[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws too-large after maxBytes + 1 streamed bytes without reading the rest', async () => {
    let pulled = 0;
    const stream = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled++;
          if (pulled > 50) controller.close();
          else controller.enqueue(new Uint8Array(10));
        },
      });
    const p = downloadBounded('https://objects.githubusercontent.com/x', {
      ...base,
      maxBytes: 25,
      fetch: fetchOf(stream),
    });
    expect(await code(p)).toBe('too-large');
    // Three chunks (30 bytes) cross the 25-byte cap; the stream is cancelled, not drained.
    expect(pulled).toBeLessThanOrEqual(5);
  });

  it('exactly maxBytes is accepted', async () => {
    const text = await downloadBounded('https://objects.githubusercontent.com/x', {
      ...base,
      maxBytes: 5,
      fetch: fetchOf('12345'),
    });
    expect(text).toBe('12345');
  });

  it('a declared content-length over the cap fails before reading', async () => {
    const f = (async () =>
      new Response('x', { headers: { 'content-length': '999' } })) as unknown as typeof fetch;
    expect(
      await code(
        downloadBounded('https://objects.githubusercontent.com/x', {
          ...base,
          maxBytes: 100,
          fetch: f,
        }),
      ),
    ).toBe('too-large');
  });

  it('http errors and network failures are classified', async () => {
    expect(
      await code(
        downloadBounded('https://objects.githubusercontent.com/x', {
          ...base,
          maxBytes: 100,
          fetch: fetchOf('x', [], 500),
        }),
      ),
    ).toBe('http');
    const boom = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(
      await code(
        downloadBounded('https://objects.githubusercontent.com/x', {
          ...base,
          maxBytes: 100,
          fetch: boom,
        }),
      ),
    ).toBe('network');
  });
});
