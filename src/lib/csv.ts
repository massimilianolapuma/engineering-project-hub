/*
 * CSV encoding (RFC 4180) for the static exports. Pure. A null is "unknown" (never 0 or
 * empty), a not-applicable column is "n/a". A string that a spreadsheet could read as a
 * formula gets a leading apostrophe; numbers are never prefixed.
 */
export type CsvValue = string | number | boolean | null | { na: true };
export const NA: CsvValue = { na: true };

const BOM = String.fromCharCode(0xfeff);
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export function csvCell(v: CsvValue): string {
  if (v === null) return 'unknown';
  if (typeof v === 'object') return 'n/a';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = FORMULA_START.test(v) ? `'${v}` : v;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 BOM, then every row (headers first) terminated by CRLF. */
export function toCsv(headers: readonly string[], rows: readonly CsvValue[][]): string {
  const line = (cells: readonly CsvValue[]) => `${cells.map(csvCell).join(',')}\r\n`;
  return `${BOM}${line(headers)}${rows.map(line).join('')}`;
}
