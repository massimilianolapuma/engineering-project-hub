import type { ControlState } from '@model/index';

/** The six control symbols, used with the same meaning on every page. */
export type ControlGlyph = '✓' | '!' | '⧖' | '?' | '–' | '✕';
export type ControlSymbolTone = 'green' | 'amber' | 'unknown' | 'muted' | 'red';
export interface ControlSymbolResult {
  glyph: ControlGlyph;
  tone: ControlSymbolTone;
}

/** Stable key per glyph, used for CSS modifiers and i18n meanings (`symbols.*`). */
export const GLYPH_KEY: Record<ControlGlyph, 'ok' | 'gap' | 'stale' | 'blind' | 'na' | 'failed'> = {
  '✓': 'ok',
  '!': 'gap',
  '⧖': 'stale',
  '?': 'blind',
  '–': 'na',
  '✕': 'failed',
};

/**
 * Symbol of a security control. Salience follows requiredness: a missing or stale optional
 * control is "not required" (–), a required one is a gap (! or ⧖). A control the collector
 * cannot see is always "not visible" (?), never calm and never healthy.
 */
export function controlSymbol(state: ControlState, required: boolean): ControlSymbolResult {
  switch (state) {
    case 'enabled':
      return { glyph: '✓', tone: 'green' };
    case 'failed':
      return { glyph: '✕', tone: 'red' };
    case 'stale':
      return required ? { glyph: '⧖', tone: 'amber' } : { glyph: '–', tone: 'muted' };
    case 'not-configured':
    case 'configured-not-run':
      return required ? { glyph: '!', tone: 'amber' } : { glyph: '–', tone: 'muted' };
    case 'not-authorised':
    case 'unknown':
    case 'collection-failed':
      return { glyph: '?', tone: 'unknown' };
    case 'not-applicable':
      return { glyph: '–', tone: 'muted' };
  }
}
