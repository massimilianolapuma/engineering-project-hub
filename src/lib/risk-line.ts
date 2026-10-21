import type { I18n } from '../i18n';

/** Sum of the measured values; null (never 0) when none of them was measured. */
export const sumKnown = (values: (number | null)[]): number | null =>
  values.every((v) => v === null) ? null : values.reduce<number>((a, v) => a + (v ?? 0), 0);

/**
 * The short "overdue · accepted" line of a project card and of the portfolio Security tooltip.
 * Unknown is never 0: an unmeasured overdue count says "not measured", and with incomplete
 * counts (a source could not be read) every figure is a lower bound ("≥ n"). Nothing is written
 * when there is nothing known to report.
 */
export function riskLine(
  i18n: Pick<I18n, 'd' | 'f' | 'number'>,
  v: { overdue: number | null; accepted: number | null; complete: boolean },
): string | undefined {
  const { d, f, number } = i18n;
  if ((v.overdue ?? 0) + (v.accepted ?? 0) <= 0) return undefined;
  const n = (x: number) => (v.complete ? number(x) : f(d.risk.atLeast, { n: number(x) }));
  const parts: string[] = [];
  parts.push(
    v.overdue === null ? d.risk.cardOverdueUnknown : f(d.risk.cardOverdue, { n: n(v.overdue) }),
  );
  if (v.accepted !== null)
    parts.push(
      f(v.accepted === 1 && v.complete ? d.risk.cardAcceptedOne : d.risk.cardAccepted, {
        n: n(v.accepted),
      }),
    );
  return parts.join(' · ');
}
