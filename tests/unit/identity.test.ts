import { describe, expect, it } from 'vitest';
import { parseIdentity } from '../../src/lib/identity';

describe('parseIdentity (Cloudflare Access get-identity)', () => {
  it('uses the name and its initials', () => {
    expect(parseIdentity({ name: 'Ada Lovelace', email: 'ada@example.com' })).toEqual({
      name: 'Ada Lovelace',
      initials: 'AL',
    });
  });

  it('falls back to the local part of the email', () => {
    expect(parseIdentity({ email: 'grace.hopper@example.com' })).toEqual({
      name: 'grace.hopper',
      initials: 'GH',
    });
  });

  it.each([
    null,
    undefined,
    '<html>login</html>',
    42,
    {},
    { name: '' },
    { name: '   ' },
    { name: 42 },
    { email: '@example.com' },
    [],
  ])('returns null for %j', (body) => {
    expect(parseIdentity(body)).toBeNull();
  });

  it('trims the name and caps it at 64 characters', () => {
    expect(parseIdentity({ name: '  Ada  ' })).toEqual({ name: 'Ada', initials: 'A' });
    const long = parseIdentity({ name: 'x'.repeat(100) });
    expect(long?.name).toHaveLength(64);
  });

  it('uses at most two initials, upper case', () => {
    expect(parseIdentity({ name: 'mary ann evans' })?.initials).toBe('MA');
  });
});
