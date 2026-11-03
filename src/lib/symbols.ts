import type { ControlState } from '@model/index';
import type { OcticonName } from './octicon';

/** The six control symbols, used with the same meaning on every page. */
export type SymbolKey = 'ok' | 'gap' | 'stale' | 'blind' | 'na' | 'failed';
export type ControlSymbolTone = 'green' | 'amber' | 'unknown' | 'muted' | 'red';
export interface ControlSymbolResult {
  /** Stable key, used for `data-symbol`, CSS modifiers and i18n meanings (`symbols.*`). */
  key: SymbolKey;
  tone: ControlSymbolTone;
}

/** One distinct Octicon shape per symbol: the shape carries the meaning, colour only helps. */
export const SYMBOL_ICON: Record<SymbolKey, OcticonName> = {
  ok: 'check-circle',
  gap: 'alert',
  stale: 'clock',
  blind: 'question',
  na: 'dash',
  failed: 'x-circle',
};

/**
 * Symbol of a security control. Salience follows requiredness: a missing or stale optional
 * control is "not required" (na), a required one is a gap (gap or stale). A control the
 * collector cannot see is always "not visible" (blind), never calm and never healthy.
 */
export function controlSymbol(state: ControlState, required: boolean): ControlSymbolResult {
  switch (state) {
    case 'enabled':
      return { key: 'ok', tone: 'green' };
    case 'failed':
      return { key: 'failed', tone: 'red' };
    case 'stale':
      return required ? { key: 'stale', tone: 'amber' } : { key: 'na', tone: 'muted' };
    case 'not-configured':
    case 'configured-not-run':
      return required ? { key: 'gap', tone: 'amber' } : { key: 'na', tone: 'muted' };
    case 'not-authorised':
    case 'unknown':
    case 'collection-failed':
      return { key: 'blind', tone: 'unknown' };
    case 'not-applicable':
      return { key: 'na', tone: 'muted' };
  }
}
