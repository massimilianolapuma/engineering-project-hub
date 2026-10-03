export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

export function fixedClock(iso: string): Clock {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) throw new Error(`Invalid --now value: ${iso}`);
  return () => new Date(t);
}

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** Resolves "@now", "@now-2h", "@now-20d", "@now-15m" against the clock. */
export function resolveRelativeTime(token: string, now: Date): string | null {
  const m = /^@now(?:([+-])(\d+)([mhd]))?$/.exec(token);
  if (!m) return null;
  const [, sign, amount, unit] = m;
  const delta = sign && amount && unit ? Number(amount) * UNIT_MS[unit as keyof typeof UNIT_MS] : 0;
  return new Date(now.getTime() + (sign === '-' ? -delta : delta)).toISOString();
}

export function ageMs(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : now.getTime() - t;
}

export const DAY_MS = UNIT_MS.d;
export const HOUR_MS = UNIT_MS.h;
export const MINUTE_MS = UNIT_MS.m;
