/*
 * Run summary of a ledger writer (markdown, for $GITHUB_STEP_SUMMARY). Repository, environment
 * and counts only: never a token, a URL with credentials or a payload.
 */
export interface SummaryRow {
  repository: string;
  environment: string;
  read: number;
  written: number;
  skipped: { reason: string; count: number }[];
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

export function renderSummary(rows: readonly SummaryRow[], header = ''): string {
  const lines = [
    header,
    '| Repository | Environment | Read | Written | Skipped |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${cell(r.repository)} | ${cell(r.environment)} | ${r.read} | ${r.written} | ${
          r.skipped.length ? r.skipped.map((s) => `${cell(s.reason)}: ${s.count}`).join(', ') : '–'
        } |`,
    ),
  ].filter((l, i) => i > 0 || l);
  return `${lines.join('\n')}\n`;
}
