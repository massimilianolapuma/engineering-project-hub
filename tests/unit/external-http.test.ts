import { describe, expect, it } from 'vitest';
import {
  createExternalClient,
  MAX_EXTERNAL_BYTES,
} from '../../collector/src/providers/external/http';

interface Seen {
  url: string;
  init: RequestInit | undefined;
}
type Handler = (url: URL) => Response | Promise<Response>;

function spy(handler: Handler = () => Response.json({ ok: true })) {
  const seen: Seen[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), init });
    return handler(new URL(String(input)));
  }) as typeof fetch;
  return { seen, fetcher };
}
const client = (
  fetcher: typeof fetch,
  over: Partial<Parameters<typeof createExternalClient>[0]> = {},
) =>
  createExternalClient({
    id: 'sonarqube',
    baseUrl: 'https://sonar.example.com/sonar',
    timeoutSeconds: 20,
    authHeader: 'Bearer t0ken-value-123',
    fetch: fetcher,
    ...over,
  });
const headersOf = (s: Seen) => new Headers(s.init?.headers);

describe('external client: URL building and host pinning', () => {
  it('builds https://sonar.example.com/sonar/api/measures/component?component=a%3Ab from baseUrl with context root', async () => {
    const { seen, fetcher } = spy();
    await client(fetcher).getJson('/api/measures/component', {}, { component: 'a:b' });
    expect(seen[0]!.url).toBe(
      'https://sonar.example.com/sonar/api/measures/component?component=a%3Ab',
    );
  });

  it('a base URL without a path or with a trailing slash joins cleanly', async () => {
    for (const baseUrl of ['https://sonar.example.com', 'https://sonar.example.com/']) {
      const { seen, fetcher } = spy();
      await client(fetcher, { baseUrl }).getJson('/api/x/{id}', { id: 'a' });
      expect(seen[0]!.url).toBe('https://sonar.example.com/api/x/a');
    }
  });

  it('param "../../admin" stays encoded and host unchanged', async () => {
    const { seen, fetcher } = spy();
    await client(fetcher).getJson('/api/v2.0/projects/{project}', { project: '../../admin' });
    const url = new URL(seen[0]!.url);
    expect(url.host).toBe('sonar.example.com');
    expect(url.pathname).toBe('/sonar/api/v2.0/projects/..%2F..%2Fadmin');
  });

  it('param "@evil.com" and "//evil.com" cannot change the host', async () => {
    for (const evil of ['@evil.com', '//evil.com', 'evil.com:8443/x', '\\\\evil.com', '?x=1#y']) {
      const { seen, fetcher } = spy();
      await client(fetcher).getJson('/api/projects/{project}', { project: evil });
      const url = new URL(seen[0]!.url);
      expect(url.host, evil).toBe('sonar.example.com');
      expect(url.search, evil).toBe('');
      expect(url.hash, evil).toBe('');
      expect(url.pathname.startsWith('/sonar/api/projects/'), evil).toBe(true);
    }
  });

  it('a param that is a dot segment is refused before any request', async () => {
    for (const bad of ['..', '.']) {
      const { seen, fetcher } = spy();
      await expect(
        client(fetcher).getJson('/api/projects/{project}', { project: bad }),
      ).rejects.toThrow(/external path mismatch/);
      expect(seen).toHaveLength(0);
    }
  });

  it('a missing template param throws before any request', async () => {
    const { seen, fetcher } = spy();
    await expect(client(fetcher).getJson('/api/{a}', {})).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });

  it('doubleEncode: "team/api" → "team%252Fapi"', async () => {
    const { seen, fetcher } = spy();
    await client(fetcher).getJson(
      '/api/v2.0/projects/{project}/repositories/{repository}/artifacts/{reference}',
      { project: 'alpha', repository: 'team/api', reference: '1.4.0' },
      {},
      { doubleEncode: ['repository'] },
    );
    expect(new URL(seen[0]!.url).pathname).toBe(
      '/sonar/api/v2.0/projects/alpha/repositories/team%252Fapi/artifacts/1.4.0',
    );
  });

  it('a non-https base URL throws "external host mismatch" before any request', async () => {
    const { seen, fetcher } = spy();
    await expect(
      client(fetcher, { baseUrl: 'http://sonar.example.com' }).getJson('/api/x', {}),
    ).rejects.toThrow('external host mismatch');
    expect(seen).toHaveLength(0);
  });
});

describe('external client: request shape', () => {
  it("passes redirect 'error', GET, a timeout signal and the fixed headers", async () => {
    const { seen, fetcher } = spy();
    await client(fetcher).getJson(
      '/api/x',
      {},
      {},
      { headers: { 'X-Accept-Vulnerabilities': 'v1' } },
    );
    const init = seen[0]!.init!;
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const h = headersOf(seen[0]!);
    expect(h.get('accept')).toBe('application/json');
    expect(h.get('user-agent')).toBe('engineering-project-hub-collector');
    expect(h.get('authorization')).toBe('Bearer t0ken-value-123');
    expect(h.get('x-accept-vulnerabilities')).toBe('v1');
  });

  it('extra headers can never replace the credential', async () => {
    const { seen, fetcher } = spy();
    await client(fetcher).getJson('/api/x', {}, {}, { headers: { Authorization: 'Bearer evil' } });
    expect(headersOf(seen[0]!).get('authorization')).toBe('Bearer t0ken-value-123');
  });

  it('authHeader null → not-authorised and fetch not called', async () => {
    const { seen, fetcher } = spy();
    const r = await client(fetcher, { authHeader: null }).getJson('/api/x', {});
    expect(r).toEqual({
      ok: false,
      error: { classification: 'not-authorised', message: 'credential not set' },
    });
    expect(seen).toHaveLength(0);
  });

  it('at most 2 requests run at the same time per client', async () => {
    let active = 0;
    let peak = 0;
    const fetcher = (async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return Response.json({});
    }) as typeof fetch;
    const c = client(fetcher);
    await Promise.all(Array.from({ length: 6 }, () => c.getJson('/api/x', {})));
    expect(peak).toBe(2);
  });
});

describe('external client: responses', () => {
  const status = (code: number) => spy(() => new Response('{"message":"x"}', { status: code }));

  it('returns the parsed JSON body', async () => {
    const { fetcher } = spy(() => Response.json({ a: [1, 2] }));
    expect(await client(fetcher).getJson('/api/x', {})).toEqual({ ok: true, data: { a: [1, 2] } });
  });

  it.each([
    [401, 'not-authorised', 'not authorised'],
    [403, 'not-authorised', 'not authorised'],
    [404, 'not-found', 'not found'],
    [429, 'rate-limited', 'rate limited'],
    [500, 'error', 'request failed'],
    [400, 'error', 'request failed'],
  ])('HTTP %i → %s', async (code, classification, message) => {
    expect(await client(status(code).fetcher).getJson('/api/x', {})).toEqual({
      ok: false,
      error: { classification, httpStatus: code, message },
    });
  });

  it('a fetch rejection (timeout, refused redirect, network) → error', async () => {
    const fetcher = (async () => {
      throw new TypeError('fetch failed: redirect mode is set to error');
    }) as unknown as typeof fetch;
    expect(await client(fetcher).getJson('/api/x', {})).toEqual({
      ok: false,
      error: { classification: 'error', message: 'request failed' },
    });
  });

  it('invalid JSON → invalid-data', async () => {
    const { fetcher } = spy(() => new Response('<html>not json</html>'));
    expect(await client(fetcher).getJson('/api/x', {})).toMatchObject({
      ok: false,
      error: { classification: 'invalid-data', message: 'invalid response' },
    });
  });

  it('error message never contains the URL, the token or the body', async () => {
    const secretBody = `{"message":"ghp_${'a'.repeat(36)}"}`;
    const outcomes = [
      await client(spy(() => new Response(secretBody, { status: 403 })).fetcher).getJson(
        '/api/projects/{p}',
        { p: 'internal-project-name' },
      ),
      await client(spy(() => new Response(secretBody, { status: 500 })).fetcher).getJson(
        '/api/x',
        {},
      ),
      await client(spy(() => new Response(`<html>${secretBody}`)).fetcher).getJson('/api/x', {}),
      await client((async () => {
        throw new Error('connect ECONNREFUSED sonar.example.com t0ken-value-123');
      }) as unknown as typeof fetch).getJson('/api/x', {}),
    ];
    for (const r of outcomes) {
      const text = JSON.stringify(r);
      expect(text).not.toContain('ghp_');
      expect(text).not.toContain('t0ken-value-123');
      expect(text).not.toContain('sonar.example.com');
      expect(text).not.toContain('internal-project-name');
    }
  });

  it('1 MiB + 1 byte → invalid-data; exactly 1 MiB is read', async () => {
    const pad = (n: number) => JSON.stringify({ p: 'x'.repeat(n - 8) });
    expect(pad(MAX_EXTERNAL_BYTES).length).toBe(MAX_EXTERNAL_BYTES);
    const ok = await client(spy(() => new Response(pad(MAX_EXTERNAL_BYTES))).fetcher).getJson(
      '/api/x',
      {},
    );
    expect(ok.ok).toBe(true);
    const over = await client(spy(() => new Response(pad(MAX_EXTERNAL_BYTES + 1))).fetcher).getJson(
      '/api/x',
      {},
    );
    expect(over).toMatchObject({ ok: false, error: { classification: 'invalid-data' } });
  });

  it('stops reading a body that is larger than the cap', async () => {
    let pulled = 0;
    const fetcher = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled++;
            if (pulled > 100) controller.close();
            else controller.enqueue(new Uint8Array(MAX_EXTERNAL_BYTES / 4));
          },
        }),
      )) as typeof fetch;
    const r = await client(fetcher).getJson('/api/x', {});
    expect(r).toMatchObject({ ok: false, error: { classification: 'invalid-data' } });
    expect(pulled).toBeLessThan(10);
  });
});
