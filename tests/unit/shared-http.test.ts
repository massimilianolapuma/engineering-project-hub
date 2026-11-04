import { describe, expect, it } from 'vitest';
import { classifyStatus } from '../../shared/http/classify';
import { buildTemplateUrl } from '../../shared/http/url';

/*
 * The audited HTTP core shared by the collector (GET, ADR 0012) and the notifier (POST, ADR 0013).
 * The collector's own tests prove the move changed nothing; these pin the extracted helpers.
 */
describe('classifyStatus', () => {
  it.each([
    [400, 'rejected'],
    [401, 'not-authorised'],
    [403, 'not-authorised'],
    [404, 'not-found'],
    [413, 'too-large'],
    [422, 'rejected'],
    [429, 'rate-limited'],
    [500, 'error'],
    [302, 'error'],
  ] as const)('%i → %s', (status, cls) => {
    expect(classifyStatus(status)).toBe(cls);
  });
});

describe('buildTemplateUrl', () => {
  const base = new URL('https://sonar.example.com/sq');

  it('encodes every parameter and keeps the base path and host', () => {
    const url = buildTemplateUrl(base, '/api/{key}/x', { key: 'a/b c' }, { q: '1' });
    expect(url.href).toBe('https://sonar.example.com/sq/api/a%2Fb%20c/x?q=1');
  });

  it('double-encodes when asked', () => {
    const url = buildTemplateUrl(base, '/p/{name}', { name: 'a/b' }, {}, ['name']);
    expect(url.pathname).toBe('/sq/p/a%252Fb');
  });

  it('refuses dot segments, missing parameters and plain http', () => {
    expect(() => buildTemplateUrl(base, '/p/{x}', { x: '..' })).toThrow('external path mismatch');
    expect(() => buildTemplateUrl(base, '/p/{x}', {})).toThrow(/"x" missing/);
    expect(() => buildTemplateUrl(new URL('http://h.example.com'), '/p', {})).toThrow(
      'external host mismatch',
    );
  });
});
