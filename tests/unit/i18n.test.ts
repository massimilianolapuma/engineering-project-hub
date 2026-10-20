import { describe, expect, it } from 'vitest';
import { REASON_CODES } from '@model/index';
import { en } from '../../src/i18n/en';
import { it as itDict } from '../../src/i18n/it';
import { format, useI18n } from '../../src/i18n';

const keys = (o: object, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

describe('i18n', () => {
  it('EN and IT have exactly the same keys', () => {
    expect(keys(itDict).sort()).toEqual(keys(en).sort());
  });
  it('every reason code has a translation in both languages', () => {
    for (const code of REASON_CODES) {
      expect(en.reasons[code], code).toBeTruthy();
      expect(itDict.reasons[code], code).toBeTruthy();
    }
  });
  it('placeholders match between languages', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    const flat = (o: object, p = ''): [string, string][] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' && v ? flat(v, `${p}${k}.`) : [[`${p}${k}`, String(v)]],
      );
    const itMap = new Map(flat(itDict));
    for (const [k, v] of flat(en)) expect(ph(itMap.get(k)!), k).toBe(ph(v));
  });
  it('formats placeholders and never prints undefined', () => {
    expect(format('{a} and {b}', { a: 1 })).toBe('1 and —');
    const i = useI18n('it');
    expect(
      i.reason({ code: 'dimension-red', level: 'red', params: { dimension: 'security' } }),
    ).toBe('Rischio sicurezza è critico');
  });
  it('uses singular wording for a count of one', () => {
    const alert = (count: number) =>
      ({ code: 'open-critical-alerts', level: 'red', params: { count } }) as const;
    expect(useI18n('it').reason(alert(1))).toBe('1 alert critico aperto');
    expect(useI18n('it').reason(alert(3))).toBe('3 alert critici aperti');
    expect(useI18n('en').reason(alert(1))).toBe('1 open critical alert');
    expect(useI18n('en').reason(alert(2))).toBe('2 open critical alerts');
    expect(useI18n('en').errors(1)).toBe('1 collection error');
    expect(useI18n('it').errors(3)).toBe('3 errori di raccolta');
  });
  it('formats durations with the locale decimal separator', () => {
    expect(useI18n('it').seconds(12_340)).toBe('12,3 s');
    expect(useI18n('en').seconds(12_340)).toBe('12.3 s');
  });
});
