import type { Dimension, HealthStatus, Reason } from '@model/index';
import { en, type Dict } from './en';
import { it } from './it';

export const LOCALES = ['en', 'it'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const DICTIONARIES: Record<Locale, Dict> = { en, it };

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/** Replaces {name} placeholders. Missing params render as "—" rather than "undefined". */
export function format(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k];
    return v === undefined || v === '' ? '—' : String(v);
  });
}

export function useI18n(locale: Locale) {
  const d = DICTIONARIES[locale];
  const numberFmt = new Intl.NumberFormat(locale === 'it' ? 'it-IT' : 'en-GB');
  const secondsFmt = new Intl.NumberFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const dateFmt = new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
  return {
    locale,
    d,
    f: format,
    status: (s: HealthStatus) => d.status[s],
    statusDesc: (s: HealthStatus) => d.status[`${s}Desc` as const],
    dimension: (dim: Dimension | 'overall' | 'freshness') => d.dimensions[dim],
    /** Renders a health reason in the current language, translating known param values. */
    reason(r: Reason): string {
      const params = { ...r.params };
      if (typeof params.dimension === 'string' && params.dimension in d.dimensions) {
        params.dimension = d.dimensions[params.dimension as keyof Dict['dimensions']];
      }
      if (typeof params.source === 'string' && params.source in d.versionSource) {
        params.source = d.versionSource[params.source as keyof Dict['versionSource']];
      }
      if (typeof params.status === 'string' && params.status in d.pinStatus) {
        params.status = d.pinStatus[params.status as keyof Dict['pinStatus']];
      }
      if (typeof params.control === 'string' && params.control in d.control) {
        params.control = d.control[params.control as keyof Dict['control']];
      }
      // Singular wording when the reason counts exactly one thing ("1 open critical alert").
      const one = (d.reasonsOne as Partial<Record<string, string>>)[r.code];
      return format(params.count === 1 && one ? one : d.reasons[r.code], params);
    },
    number: (n: number) => numberFmt.format(n),
    /** Collection error count with singular/plural wording. */
    errors: (count: number) =>
      format(count === 1 ? d.common.errorsOne : d.common.errors, { count }),
    /** A duration in seconds with one decimal, in the locale's number format ("12,3 s"). */
    seconds: (ms: number) => `${secondsFmt.format(ms / 1000)} s`,
    /** Absolute UTC date; the client script adds a relative "x ago" label. */
    date: (iso: string | null | undefined) =>
      iso ? `${dateFmt.format(new Date(iso))} UTC` : d.common.unknown,
  };
}

export type I18n = ReturnType<typeof useI18n>;
