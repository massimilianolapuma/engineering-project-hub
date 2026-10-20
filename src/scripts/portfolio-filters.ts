/**
 * Client-side filtering and sorting of the pre-rendered portfolio list. No network calls.
 * The filter state lives in the URL query (?q=&health=&bu=&sort=&lifecycle=&severity=), so a
 * filtered view can be shared and survives a reload; the list is filtered on load too.
 */
import { resultsLine, severityMatch } from '../lib/portfolio-filters-core';
import { scoreSortKey } from '../lib/score';

const form = document.querySelector<HTMLFormElement>('[data-portfolio-filters]');
const tbody = document.querySelector<HTMLTableSectionElement>('[data-portfolio-table] tbody');
const results = document.querySelector<HTMLElement>('[data-results]');
const empty = document.querySelector<HTMLElement>('[data-empty]');

/** Form fields mirrored in the URL, with the value that means "no filter". */
const FIELDS = {
  q: '',
  health: '',
  bu: '',
  sort: 'score',
  lifecycle: '',
  severity: '',
} as const;
type Field = keyof typeof FIELDS;
const NAMES = Object.keys(FIELDS) as Field[];

if (form && tbody) {
  const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr[data-project]'));
  const field = (name: Field) =>
    form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
  const value = (name: Field) => field(name)?.value ?? '';
  // The status counts above the list are shortcuts for the status filter.
  const counts = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-health-filter]'));
  const clearButtons = Array.from(document.querySelectorAll<HTMLElement>('[data-clear-filters]'));
  const more = form.querySelector<HTMLDetailsElement>('[data-more-filters]');
  // Phones: the fields sit in one "Filters" disclosure, closed unless a filter is set.
  const filterbox = form.querySelector<HTMLDetailsElement>('[data-filterbox]');
  const phone = window.matchMedia('(max-width: 720px)');
  const healthSelect = field('health') as HTMLSelectElement | null;

  /** Sets a field only to a value it can hold (a select ignores unknown options). */
  const setField = (name: Field, v: string) => {
    const el = field(name);
    if (!el) return;
    if (el instanceof HTMLSelectElement && !Array.from(el.options).some((o) => o.value === v))
      return;
    el.value = v;
  };

  const writeUrl = () => {
    const url = new URL(window.location.href);
    for (const n of NAMES) {
      const v = n === 'q' ? value(n).trim() : value(n);
      if (v && v !== FIELDS[n]) url.searchParams.set(n, v);
      else url.searchParams.delete(n);
    }
    if (url.href !== window.location.href) window.history.replaceState(null, '', url);
  };

  const apply = () => {
    const q = value('q').trim().toLowerCase();
    const health = value('health');
    const bu = value('bu');
    const lifecycle = value('lifecycle');
    const severity = value('severity');
    const sort = value('sort');
    let shown = 0;
    // Hidden only because their open-alert counts are unknown: never dropped silently.
    let unknownHidden = 0;
    for (const r of rows) {
      const d = r.dataset;
      const others =
        (!q || (d.search ?? d.name ?? '').includes(q)) &&
        (!health || d.health === health) &&
        (!bu || d.bu === bu) &&
        (!lifecycle || d.lifecycle === lifecycle);
      const sev = severityMatch(severity, Number(d.critical), Number(d.high));
      const ok = others && sev === 'match';
      r.hidden = !ok;
      if (ok) shown++;
      else if (others && sev === 'unknown') unknownHidden++;
    }
    const key = (r: HTMLTableRowElement): number => {
      const d = r.dataset;
      switch (sort) {
        case 'name':
          return 0;
        case 'updated':
          return -Date.parse(d.updated ?? '');
        case 'critical': {
          // Unknown (-1) sits between projects with alerts and projects with none.
          const c = Number(d.critical);
          return c < 0 ? -0.5 : -c;
        }
        case 'health':
          return Number(d.rank);
        default:
          // Score, lowest first; "insufficient data" (empty) sorts right after red.
          return scoreSortKey({ value: d.score ? Number(d.score) : null });
      }
    };
    rows
      .sort((a, b) => key(a) - key(b) || (a.dataset.name ?? '').localeCompare(b.dataset.name ?? ''))
      .forEach((r) => tbody.appendChild(r));
    if (results)
      results.textContent = resultsLine(
        results.dataset.template ?? '',
        shown,
        rows.length,
        unknownHidden,
        { one: results.dataset.unknownOne ?? '', other: results.dataset.unknownOther ?? '' },
      );
    if (empty) empty.hidden = shown > 0;
    const filtered = !!(q || health || bu || lifecycle || severity);
    // The button in the filter row; the one in the empty message shows with that message.
    for (const b of clearButtons) if (!empty?.contains(b)) b.hidden = !filtered;
    for (const b of counts)
      b.setAttribute('aria-pressed', String(!!health && b.dataset.healthFilter === health));
    writeUrl();
  };

  /** Restores the filters from the URL (a shared link) or keeps what the browser restored. */
  const readUrl = () => {
    const params = new URLSearchParams(window.location.search);
    for (const n of NAMES) {
      const v = params.get(n);
      if (v !== null) setField(n, v);
    }
    if (more && (value('lifecycle') || value('severity'))) more.open = true;
    syncFilterbox();
  };

  /** Any field away from its "no filter" value (the sort too: it lives in the same box). */
  const anySet = () => NAMES.some((n) => (n === 'q' ? value(n).trim() : value(n)) !== FIELDS[n]);
  /** Desktop: always open (its summary is hidden). Phone: open only when a filter is set. */
  const syncFilterbox = () => {
    if (filterbox) filterbox.open = !phone.matches || anySet();
  };

  const clear = () => {
    for (const n of NAMES) setField(n, FIELDS[n]);
    apply();
    field('q')?.focus();
  };

  for (const b of counts)
    b.addEventListener('click', () => {
      if (!healthSelect) return;
      const target = b.dataset.healthFilter ?? '';
      // Pressing the active count again clears the filter.
      healthSelect.value = healthSelect.value === target ? '' : target;
      apply();
    });
  for (const b of clearButtons) b.addEventListener('click', clear);
  form.addEventListener('input', apply);
  form.addEventListener('change', apply);
  form.addEventListener('submit', (e) => e.preventDefault());
  // Back/forward cache and form restoration: filter what the controls show.
  window.addEventListener('pageshow', apply);
  phone.addEventListener('change', syncFilterbox);
  readUrl();
  apply();
}
