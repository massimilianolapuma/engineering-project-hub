import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertPublishable,
  SanitizationError,
  sanitizeUrl,
  scrubText,
} from '../../collector/src/sanitizers/sanitize';
import { findSecretPatterns } from '../../shared/security/patterns';
import { CANARIES } from '../helpers/canaries';

describe('scrubText', () => {
  it.each(CANARIES)('removes canary %s', (canary) => {
    const out = scrubText(`Alert for ${canary} in config`, 500)!;
    expect(out).not.toContain(canary);
    expect(findSecretPatterns(out)).toEqual([]);
  });

  it('removes PEM blocks, code fences, inline code and stack traces', () => {
    const input = [
      'Failure -----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
      '```js\nconst token = "x";\n```',
      'see `db.query(userInput)`',
      '    at handler (/app/src/index.js:10:5)',
    ].join('\n');
    const out = scrubText(input, 500)!;
    expect(out).not.toMatch(/MIIabc|PRIVATE KEY|db\.query|index\.js:10/);
    expect(out).toContain('[code removed]');
  });

  it('removes headers, query strings and control characters, and truncates', () => {
    const out = scrubText(
      'Authorization: token abc\nGET https://api.example.com/x?access_token=abc#frag\u0007',
      500,
    )!;
    expect(out).not.toMatch(/token abc|access_token|frag/);
    expect(out).not.toContain(String.fromCharCode(7));
    expect(scrubText('a'.repeat(400), 50)!.length).toBe(50);
  });

  it('removes values of credentials present in the environment', () => {
    vi.stubEnv('GH_READ_TOKEN', 'synthetic-env-credential-123456');
    expect(scrubText('leak synthetic-env-credential-123456 here')).toBe('leak [redacted] here');
  });

  it('keeps null as null', () => expect(scrubText(null)).toBeNull());
});

afterEach(() => vi.unstubAllEnvs());

describe('sanitizeUrl', () => {
  const hosts = ['github.com'];
  it('keeps https links on allowed hosts without query, fragment or credentials', () => {
    expect(
      sanitizeUrl('https://user:pw@github.com/o/r/security/code-scanning/1?ref=x#y', hosts),
    ).toBe('https://github.com/o/r/security/code-scanning/1');
  });
  it.each([
    'http://github.com/o/r',
    'https://evil.example/o/r',
    'javascript:alert(1)',
    'not a url',
    'https://github.com.evil.example/',
  ])('drops %s', (u) => expect(sanitizeUrl(u, hosts)).toBeNull());
});

describe('assertPublishable (final gate)', () => {
  it.each(CANARIES)('fails when %s reaches the output', (canary) => {
    expect(() => assertPublishable(JSON.stringify({ title: `x ${canary}` }), 'test.json')).toThrow(
      SanitizationError,
    );
  });
  it('detects secret-bearing JSON keys but allows numeric aggregates', () => {
    expect(() => assertPublishable('{"secret":"abc"}', 't')).toThrow(SanitizationError);
    expect(() => assertPublishable('{"secret":0,"secretOpen":2}', 't')).not.toThrow();
  });
  it('reports pattern names only, never the value', () => {
    try {
      assertPublishable('ghp_exampleSecretValue', 't');
    } catch (e) {
      expect((e as Error).message).not.toContain('ghp_exampleSecretValue');
      expect((e as SanitizationError).patterns).toContain('github-token');
    }
  });
});
