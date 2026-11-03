import { describe, expect, it } from 'vitest';
import { scanLine } from '../../src/lib/supply-chain-view';

const names = (k: string, n: number) => `${n} ${k}`;

describe('scanLine (image scan text)', () => {
  it('counts with findings → the non-zero severities', () => {
    expect(
      scanLine({ critical: 0, high: 0, medium: 2, low: 6, informational: 0, unknown: 0 }, names),
    ).toEqual({ kind: 'counts', text: '2 medium · 6 low' });
  });
  it('every severity 0 → clean', () => {
    expect(
      scanLine({ critical: 0, high: 0, medium: 0, low: 0, informational: 0, unknown: 0 }, names),
    ).toEqual({ kind: 'clean', text: '' });
  });
  it('I-5: null counts, or any null severity, is unknown, never clean', () => {
    expect(scanLine(null, names)).toEqual({ kind: 'unknown', text: '' });
    expect(
      scanLine(
        { critical: null, high: null, medium: null, low: null, informational: 0, unknown: null },
        names,
      ),
    ).toEqual({ kind: 'unknown', text: '' });
  });
});
