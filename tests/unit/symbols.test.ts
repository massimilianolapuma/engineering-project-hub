import { describe, expect, it } from 'vitest';
import { ControlStateSchema, type ControlState } from '@model/index';
import { SYMBOL_ICON, controlSymbol } from '../../src/lib/symbols';

type Expected = ReturnType<typeof controlSymbol>;

/** The one mapping used on every page: [required, not required]. */
const TABLE: Record<ControlState, [Expected, Expected]> = {
  enabled: [
    { key: 'ok', tone: 'green' },
    { key: 'ok', tone: 'green' },
  ],
  failed: [
    { key: 'failed', tone: 'red' },
    { key: 'failed', tone: 'red' },
  ],
  stale: [
    { key: 'stale', tone: 'amber' },
    { key: 'na', tone: 'muted' },
  ],
  'not-configured': [
    { key: 'gap', tone: 'amber' },
    { key: 'na', tone: 'muted' },
  ],
  'configured-not-run': [
    { key: 'gap', tone: 'amber' },
    { key: 'na', tone: 'muted' },
  ],
  'not-authorised': [
    { key: 'blind', tone: 'unknown' },
    { key: 'blind', tone: 'unknown' },
  ],
  unknown: [
    { key: 'blind', tone: 'unknown' },
    { key: 'blind', tone: 'unknown' },
  ],
  'collection-failed': [
    { key: 'blind', tone: 'unknown' },
    { key: 'blind', tone: 'unknown' },
  ],
  'not-applicable': [
    { key: 'na', tone: 'muted' },
    { key: 'na', tone: 'muted' },
  ],
};

describe('controlSymbol', () => {
  it('covers every control state', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...ControlStateSchema.options].sort());
  });

  describe.each(ControlStateSchema.options)('%s', (state) => {
    it('when required', () => {
      expect(controlSymbol(state, true)).toEqual(TABLE[state][0]);
    });
    it('when not required', () => {
      expect(controlSymbol(state, false)).toEqual(TABLE[state][1]);
    });
  });

  it('never renders a blind spot as calm or healthy', () => {
    for (const s of ['not-authorised', 'unknown', 'collection-failed'] as const)
      for (const req of [true, false]) {
        const { tone, key } = controlSymbol(s, req);
        expect(tone).toBe('unknown');
        expect(key).not.toBe('ok');
      }
  });

  it('maps every key to a distinct Octicon shape', () => {
    expect(SYMBOL_ICON).toEqual({
      ok: 'check-circle',
      gap: 'alert',
      stale: 'clock',
      blind: 'question',
      na: 'dash',
      failed: 'x-circle',
    });
    expect(new Set(Object.values(SYMBOL_ICON)).size).toBe(6);
  });
});
