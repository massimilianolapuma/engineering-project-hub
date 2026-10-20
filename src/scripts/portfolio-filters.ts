/** Client-side filtering and sorting of the pre-rendered portfolio list. No network calls. */
import { scoreSortKey } from '../lib/score';

const form = document.querySelector<HTMLFormElement>('[data-portfolio-filters]');
const tbody = document.querySelector<HTMLTableSectionElement>('[data-portfolio-table] tbody');
const results = document.querySelector<HTMLElement>('[data-results]');
const empty = document.querySelector<HTMLElement>('[data-empty]');

if (form && tbody) {
  const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr[data-project]'));
  const value = (name: string) =>
    (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
  // The status counts above the list are shortcuts for the status filter.
  const counts = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-health-filter]'));
  const healthSelect = form.elements.namedItem('health') as HTMLSelectElement | null;

  const apply = () => {
    const q = value('q').trim().toLowerCase();
    const health = value('health');
    const bu = value('bu');
    const lifecycle = value('lifecycle');
    const severity = value('severity');
    const sort = value('sort');
    let shown = 0;
    for (const r of rows) {
      const d = r.dataset;
      const critical = Number(d.critical);
      const high = Number(d.high);
      const ok =
        (!q || (d.search ?? d.name ?? '').includes(q)) &&
        (!health || d.health === health) &&
        (!bu || d.bu === bu) &&
        (!lifecycle || d.lifecycle === lifecycle) &&
        (severity !== 'critical' || critical > 0) &&
        (severity !== 'high' || critical > 0 || high > 0);
      r.hidden = !ok;
      if (ok) shown++;
    }
    const key = (r: HTMLTableRowElement): number => {
      const d = r.dataset;
      switch (sort) {
        case 'name':
          return 0;
        case 'updated':
          return -Date.parse(d.updated ?? '');
        case 'critical':
          return -Number(d.critical);
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
      results.textContent = (results.dataset.template ?? '')
        .replace('{shown}', String(shown))
        .replace('{total}', String(rows.length));
    if (empty) empty.hidden = shown > 0;
    for (const b of counts)
      b.setAttribute('aria-pressed', String(!!health && b.dataset.healthFilter === health));
  };

  for (const b of counts)
    b.addEventListener('click', () => {
      if (!healthSelect) return;
      const target = b.dataset.healthFilter ?? '';
      // Pressing the active count again clears the filter.
      healthSelect.value = healthSelect.value === target ? '' : target;
      apply();
    });
  form.addEventListener('input', apply);
  form.addEventListener('change', apply);
  form.addEventListener('submit', (e) => e.preventDefault());
}
