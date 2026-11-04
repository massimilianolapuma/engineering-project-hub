import { afterEach, describe, expect, it, vi } from 'vitest';
import { postOnce } from '../../notifier/src/http';

/*
 * The notifier's only outward request (spec §5.5.5, D13): POST once, https, an allowed Teams host,
 * no redirect, no retry, nothing logged. Every check happens before any request.
 */
const ALLOWED = ['environment.api.powerplatform.com'];
const OK_URL = 'https://abc.environment.api.powerplatform.com/powerautomate/x?sig=s3cr3t';
const respond = (status: number) =>
  vi.fn(async () => new Response(status === 204 ? null : '{"ok":true}', { status }));

afterEach(() => vi.restoreAllMocks());

describe('postOnce refuses before any request', () => {
  it.each([
    ['plain http', 'http://abc.environment.api.powerplatform.com/x'],
    ['userinfo', 'https://u:p@abc.environment.api.powerplatform.com/x'],
    ['another host', 'https://evil.example.com/x'],
    ['a look-alike suffix', 'https://abc.environment.api.powerplatform.com.evil.example.com/x'],
    ['not a URL', 'not a url'],
  ])('%s', async (_, url) => {
    const fetch = respond(202);
    expect(await postOnce({ url, body: '{}', allowedHostSuffixes: ALLOWED, fetch })).toEqual({
      outcome: 'refused',
      reason: 'host-not-allowed',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('postOnce outcomes', () => {
  it('posts once, JSON, no redirects', async () => {
    const fetch = respond(202);
    expect(
      await postOnce({ url: OK_URL, body: '{"a":1}', allowedHostSuffixes: ALLOWED, fetch }),
    ).toEqual({
      outcome: 'sent',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it.each([
    [400, 'rejected'],
    [401, 'not-authorised'],
    [404, 'not-found'],
    [413, 'too-large'],
    [429, 'rate-limited'],
    [500, 'error'],
  ] as const)('%i → %s, called exactly once', async (status, outcome) => {
    const fetch = respond(status);
    expect(
      await postOnce({ url: OK_URL, body: '{}', allowedHostSuffixes: ALLOWED, fetch }),
    ).toEqual({
      outcome,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a network error is "error", and nothing is logged', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const fetch = vi.fn(async () => {
      throw new TypeError(`fetch failed for ${OK_URL}`);
    });
    expect(
      await postOnce({ url: OK_URL, body: '{}', allowedHostSuffixes: ALLOWED, fetch }),
    ).toEqual({
      outcome: 'error',
    });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
