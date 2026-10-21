import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ExceptionEntrySchema, ExceptionsFileSchema, countsAsOpen } from '@model/index';

const base = {
  id: 'EXC-0001',
  repository: 'example-org/project-beta-api',
  source: 'code-scanning',
  match: { alert: 3 },
  owner: 'team-beta',
  reason: 'Accepted for the demo only.',
  created: '2026-01-05',
  expires: '2026-02-04',
};
const entry = (over: Record<string, unknown> = {}) => ({ ...base, ...over });
const file = (...exceptions: unknown[]) => ({ schemaVersion: '1.0', exceptions });

describe('ExceptionEntrySchema', () => {
  it('accepts the base entry, a rule+tool selector and an @org/team owner', () => {
    expect(ExceptionEntrySchema.safeParse(base).success).toBe(true);
    expect(
      ExceptionEntrySchema.safeParse(entry({ match: { rule: 'py/flask-debug', tool: 'CodeQL' } }))
        .success,
    ).toBe(true);
    expect(ExceptionEntrySchema.safeParse(entry({ owner: '@example-org/team-beta' })).success).toBe(
      true,
    );
  });

  it('accepts { advisory: "GHSA-demo-0004-mono" } and { advisory: "CVE-2025-12345" } for dependabot', () => {
    for (const advisory of ['GHSA-demo-0004-mono', 'CVE-2025-12345']) {
      expect(
        ExceptionEntrySchema.safeParse(entry({ source: 'dependabot', match: { advisory } }))
          .success,
      ).toBe(true);
    }
  });

  it('rejects a rule selector for dependabot and an advisory selector for code-scanning', () => {
    expect(
      ExceptionEntrySchema.safeParse(entry({ source: 'dependabot', match: { rule: 'x/y' } }))
        .success,
    ).toBe(false);
    expect(
      ExceptionEntrySchema.safeParse(entry({ match: { advisory: 'CVE-2025-12345' } })).success,
    ).toBe(false);
  });

  it('rejects any non-alert selector for secret-scanning', () => {
    const r = ExceptionEntrySchema.safeParse(
      entry({ source: 'secret-scanning', match: { rule: 'any' } }),
    );
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === 'match')).toBe(true);
  });

  it('rejects owner "alice@example.com"', () => {
    expect(ExceptionEntrySchema.safeParse(entry({ owner: 'alice@example.com' })).success).toBe(
      false,
    );
  });

  it('rejects reason "too short" (9 chars) and a 301-char reason', () => {
    expect(ExceptionEntrySchema.safeParse(entry({ reason: 'too short' })).success).toBe(false);
    expect(ExceptionEntrySchema.safeParse(entry({ reason: 'x'.repeat(301) })).success).toBe(false);
    expect(ExceptionEntrySchema.safeParse(entry({ reason: 'x'.repeat(300) })).success).toBe(true);
  });

  it('rejects created "2026-02-30" and expires before created', () => {
    expect(ExceptionEntrySchema.safeParse(entry({ created: '2026-02-30' })).success).toBe(false);
    expect(ExceptionEntrySchema.safeParse(entry({ expires: '2026-01-04' })).success).toBe(false);
  });

  it('rejects an unknown key ("severity")', () => {
    expect(ExceptionEntrySchema.safeParse(entry({ severity: 'high' })).success).toBe(false);
  });

  it('rejects an http (non-https) ticket', () => {
    expect(ExceptionEntrySchema.safeParse(entry({ ticket: 'http://example.com/1' })).success).toBe(
      false,
    );
    expect(ExceptionEntrySchema.safeParse(entry({ ticket: 'https://example.com/1' })).success).toBe(
      true,
    );
  });
});

describe('ExceptionsFileSchema', () => {
  it('rejects a file with two "EXC-0001" ids with message \'duplicate id "EXC-0001"\'', () => {
    const r = ExceptionsFileSchema.safeParse(file(base, entry({ match: { alert: 4 } })));
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues.map((i) => i.message)).toContain('duplicate id "EXC-0001"');
  });

  it('rejects two entries with the same repository (different case), source and alert number', () => {
    const r = ExceptionsFileSchema.safeParse(
      file(base, entry({ id: 'EXC-0002', repository: 'Example-Org/Project-Beta-API' })),
    );
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues.some((i) => /duplicate selector/.test(i.message))).toBe(true);
  });

  it('accepts an empty list and distinct entries', () => {
    expect(ExceptionsFileSchema.safeParse(file()).success).toBe(true);
    expect(
      ExceptionsFileSchema.safeParse(file(base, entry({ id: 'EXC-0002', match: { alert: 4 } })))
        .success,
    ).toBe(true);
  });
});

describe('countsAsOpen', () => {
  it('open/null → true; open/active → false; open/expired → true; fixed/null → false', () => {
    expect(countsAsOpen({ status: 'open', exception: null })).toBe(true);
    expect(countsAsOpen({ status: 'open' })).toBe(true);
    expect(countsAsOpen({ status: 'open', exception: { state: 'active' } })).toBe(false);
    expect(countsAsOpen({ status: 'open', exception: { state: 'expired' } })).toBe(true);
    expect(countsAsOpen({ status: 'fixed', exception: null })).toBe(false);
  });
});

describe('advisory selector (schema, JSON Schema and bounds)', () => {
  const advisoryEntry = (advisory: string) => entry({ source: 'dependabot', match: { advisory } });

  it('accepts lower-case ids in Zod and in the generated JSON Schema pattern', () => {
    const id = 'ghsa-abcd-1234-wxyz';
    expect(ExceptionEntrySchema.safeParse(advisoryEntry(id)).success).toBe(true);
    expect(ExceptionEntrySchema.safeParse(advisoryEntry('cve-2025-12345')).success).toBe(true);
    const schema = JSON.parse(readFileSync('config/schema/exceptions.schema.json', 'utf8'));
    const patterns = [...JSON.stringify(schema).matchAll(/"pattern":\s*("(?:[^"\\]|\\.)*")/g)]
      .map((m) => JSON.parse(m[1]!) as string)
      .filter((p) => p.includes('GHSA') || p.includes('Gg'));
    expect(patterns.length).toBeGreaterThan(0);
    for (const p of patterns) {
      expect(new RegExp(p).test(id), p).toBe(true);
      expect(new RegExp(p).test('cve-2025-12345'), p).toBe(true);
    }
  });

  it('bounds the length (no 10 000-digit CVE number)', () => {
    expect(
      ExceptionEntrySchema.safeParse(advisoryEntry(`CVE-2025-${'1'.repeat(200)}`)).success,
    ).toBe(false);
  });
});

describe('selector identity', () => {
  it('{rule} and {rule, tool: "*"} are different selectors, not duplicates', () => {
    const r = ExceptionsFileSchema.safeParse(
      file(
        entry({ match: { rule: 'py/flask-debug' }, source: 'code-scanning' }),
        entry({ id: 'EXC-0002', match: { rule: 'py/flask-debug', tool: '*' } }),
      ),
    );
    expect(r.success).toBe(true);
  });
});
