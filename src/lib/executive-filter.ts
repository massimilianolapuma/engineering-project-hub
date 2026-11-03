import { buildExecutiveView, EXEC_STATUSES, filterInput, type ExecInput } from './executive';
import { execDateFormatter, executiveText, type ExecStrings } from './executive-text';
import { normalizeTeams } from './portfolio-filters-core';

/*
 * The team filter of the executive page, without the DOM (src/scripts/executive-team.ts only
 * writes these strings into the pre-rendered slots with textContent). The selected team values
 * are used to match projects and never appear in the result.
 */

export interface TeamFilterPlan {
  /** data-slot key → text. */
  slots: Record<string, string>;
  /** Risk items to show, in risk order. */
  visibleRisks: string[];
  filtered: string;
}

const COLS = ['now', 'compare', 'start'] as const;

export function teamFilterPlan(
  input: ExecInput,
  strings: ExecStrings,
  locale: 'en' | 'it',
  rawTeams: string[],
): TeamFilterPlan | null {
  const teams = normalizeTeams(rawTeams);
  if (teams.length === 0) return null;
  const view = buildExecutiveView(filterInput(input, teams));
  const text = executiveText(view, strings, execDateFormatter(locale));
  const filtered = text.filtered(view.total, input.projects.length);
  const slots: Record<string, string> = {
    lede: text.lede,
    trendSentence: text.trendSentence,
    remediation: text.remediation,
    exceptions: text.exceptions,
    supplyChain: text.supplyChain,
    filtered,
  };
  for (const s of EXEC_STATUSES) slots[`tiles.${s}`] = String(view.tiles[s]);
  for (const row of [...EXEC_STATUSES, 'projects'] as const)
    for (const col of COLS) {
      const n = view.trend.rows[row][col];
      slots[`trend.${row}.${col}`] = n === null ? strings.trend.notEnough : String(n);
    }
  return { slots, visibleRisks: view.risks.map((r) => r.id), filtered };
}
