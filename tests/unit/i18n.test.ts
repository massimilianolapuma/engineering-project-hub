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
  it('agrees in number for the risk reasons (accepted findings, SLA classes)', () => {
    const accepted = (count: number) =>
      ({ code: 'security-exception-active', level: 'info', params: { count } }) as const;
    expect(useI18n('en').reason(accepted(1))).toBe('1 finding accepted by a security exception');
    expect(useI18n('en').reason(accepted(2))).toBe('2 findings accepted by security exceptions');
    expect(useI18n('it').reason(accepted(1))).toBe(
      '1 problema accettato con eccezione di sicurezza',
    );
    expect(useI18n('it').reason(accepted(2))).toBe(
      '2 problemi accettati con eccezioni di sicurezza',
    );
    const overdue = (count: number) =>
      ({
        code: 'sla-overdue',
        level: 'amber',
        params: { count, severity: 'high', days: 30 },
      }) as const;
    expect(useI18n('it').reason(overdue(1))).toBe(
      '1 alert aperto oltre lo SLA di 30 giorni (alto)',
    );
    expect(useI18n('it').reason(overdue(2))).toBe(
      '2 alert aperti oltre lo SLA di 30 giorni (alti)',
    );
  });
  it('formats percentages with the locale decimal separator', () => {
    expect(useI18n('it').percent(67.2)).toBe('67,2%');
    expect(useI18n('en').percent(67.2)).toBe('67.2%');
    expect(useI18n('en').percent(80)).toBe('80%');
    const below = {
      code: 'quality-below-threshold',
      level: 'amber',
      params: { percentage: 67.2, threshold: 80, components: 'coordinator, api' },
    } as const;
    expect(useI18n('it').reason(below)).toBe(
      'Copertura test 67,2%, sotto il 80% (coordinator, api)',
    );
    expect(useI18n('en').reason(below)).toBe('Test coverage 67.2%, below 80% (coordinator, api)');
  });
  it('lists the components in every quality reason', () => {
    const r = (code: 'quality-not-applicable' | 'quality-all-above-threshold') =>
      ({ code, level: 'info', params: { components: 'helm, docs', percentage: 84.7 } }) as const;
    for (const locale of ['en', 'it'] as const) {
      expect(useI18n(locale).reason(r('quality-not-applicable'))).toContain('helm, docs');
      expect(useI18n(locale).reason(r('quality-all-above-threshold'))).toContain('helm, docs');
    }
    expect(useI18n('it').reason(r('quality-all-above-threshold'))).toContain('84,7%');
  });
  it('formats durations with the locale decimal separator', () => {
    expect(useI18n('it').seconds(12_340)).toBe('12,3 s');
    expect(useI18n('en').seconds(12_340)).toBe('12.3 s');
  });
});
