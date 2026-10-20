import { describe, expect, it } from 'vitest';
import { ControlStateSchema, type ControlState } from '@model/index';
import { controlSymbol } from '../../src/lib/symbols';

type Expected = ReturnType<typeof controlSymbol>;

/** The one mapping used on every page: [required, not required]. */
const TABLE: Record<ControlState, [Expected, Expected]> = {
  enabled: [
    { glyph: '✓', tone: 'green' },
    { glyph: '✓', tone: 'green' },
  ],
  failed: [
    { glyph: '✕', tone: 'red' },
    { glyph: '✕', tone: 'red' },
  ],
  stale: [
    { glyph: '⧖', tone: 'amber' },
    { glyph: '–', tone: 'muted' },
  ],
  'not-configured': [
    { glyph: '!', tone: 'amber' },
    { glyph: '–', tone: 'muted' },
  ],
  'configured-not-run': [
    { glyph: '!', tone: 'amber' },
    { glyph: '–', tone: 'muted' },
  ],
  'not-authorised': [
    { glyph: '?', tone: 'unknown' },
    { glyph: '?', tone: 'unknown' },
  ],
  unknown: [
    { glyph: '?', tone: 'unknown' },
    { glyph: '?', tone: 'unknown' },
  ],
  'collection-failed': [
    { glyph: '?', tone: 'unknown' },
    { glyph: '?', tone: 'unknown' },
  ],
  'not-applicable': [
    { glyph: '–', tone: 'muted' },
    { glyph: '–', tone: 'muted' },
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
        const { tone, glyph } = controlSymbol(s, req);
        expect(tone).toBe('unknown');
        expect(glyph).not.toBe('✓');
      }
  });
});
