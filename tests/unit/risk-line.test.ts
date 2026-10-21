import { describe, expect, it } from 'vitest';
import { useI18n } from '../../src/i18n';
import { riskLine } from '../../src/lib/risk-line';

describe('riskLine (unknown is never 0)', () => {
  const en = useI18n('en');
  const it_ = useI18n('it');

  it('writes nothing when there is nothing to say', () => {
    expect(riskLine(en, { overdue: 0, accepted: 0, complete: true })).toBeUndefined();
    expect(riskLine(en, { overdue: null, accepted: null, complete: true })).toBeUndefined();
    expect(riskLine(en, { overdue: null, accepted: 0, complete: true })).toBeUndefined();
  });

  it('shows unmeasured overdue as not measured, never as 0', () => {
    const line = riskLine(en, { overdue: null, accepted: 1, complete: true })!;
    expect(line).toContain('1 accepted');
    expect(line).toContain('not measured');
    expect(line).not.toMatch(/\b0 overdue/);
  });

  it('prefixes a lower bound when counts are incomplete', () => {
    expect(riskLine(en, { overdue: 2, accepted: 1, complete: false })).toBe(
      '≥ 2 overdue · ≥ 1 accepted',
    );
    expect(riskLine(en, { overdue: 2, accepted: 1, complete: true })).toBe(
      '2 overdue · 1 accepted',
    );
  });

  it('agrees in number in Italian', () => {
    expect(riskLine(it_, { overdue: 1, accepted: 1, complete: true })).toBe(
      '1 in ritardo · 1 accettato',
    );
    expect(riskLine(it_, { overdue: 2, accepted: 3, complete: true })).toBe(
      '2 in ritardo · 3 accettati',
    );
  });
});
