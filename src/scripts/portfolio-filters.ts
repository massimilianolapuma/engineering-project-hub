/** Client-side filtering and sorting of the pre-rendered portfolio table. No network calls. */
const form = document.querySelector<HTMLFormElement>('[data-portfolio-filters]');
const tbody = document.querySelector<HTMLTableSectionElement>('[data-portfolio-table] tbody');
const results = document.querySelector<HTMLElement>('[data-results]');
const empty = document.querySelector<HTMLElement>('[data-empty]');

if (form && tbody) {
  const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr[data-project]'));
  const value = (name: string) =>
    (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';

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
        (!q || (d.name ?? '').includes(q)) &&
        (!health || d.health === health) &&
        (!bu || d.bu === bu) &&
        (!lifecycle || d.lifecycle === lifecycle) &&
        (severity !== 'critical' || critical > 0) &&
        (severity !== 'high' || critical > 0 || high > 0);
      r.hidden = !ok;
      if (ok) shown++;
    }
    const key = (r: HTMLTableRowElement): [number, string] => {
      const d = r.dataset;
      switch (sort) {
        case 'name':
          return [0, d.name ?? ''];
        case 'updated':
          return [-Date.parse(d.updated ?? ''), d.name ?? ''];
        case 'critical':
          return [-Number(d.critical), d.name ?? ''];
        default:
          return [Number(d.rank), d.name ?? ''];
      }
    };
    rows
      .sort((a, b) => {
        const [ka, na] = key(a);
        const [kb, nb] = key(b);
        return ka - kb || na.localeCompare(nb);
      })
      .forEach((r) => tbody.appendChild(r));
    if (results)
      results.textContent = (results.dataset.template ?? '')
        .replace('{shown}', String(shown))
        .replace('{total}', String(rows.length));
    if (empty) empty.hidden = shown > 0;
  };
  form.addEventListener('input', apply);
  form.addEventListener('change', apply);
  form.addEventListener('submit', (e) => e.preventDefault());
}
