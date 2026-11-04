import { parseControlFilters, rowVisible, type ControlFilters } from '../lib/control-map-filter';

/*
 * Control map page behaviour: filters (business unit, area, ?team=) and the cell detail. A cell
 * button copies its pre-rendered <template> into the detail panel (cloneNode: no innerHTML) and
 * moves focus there; Escape returns focus to the cell.
 */

const root = document.querySelector<HTMLElement>('[data-cm]');
if (root) init(root);

function init(root: HTMLElement) {
  const table = root.querySelector<HTMLTableElement>('[data-cm-table]')!;
  const panel = root.querySelector<HTMLElement>('#cm-detail')!;
  const body = panel.querySelector<HTMLElement>('[data-cm-detail-body]')!;
  const empty = root.querySelector<HTMLElement>('[data-cm-empty]');
  const selects = root.querySelectorAll<HTMLSelectElement>('[data-cm-filter]');
  const teamLine = root.querySelector<HTMLElement>('[data-cm-team]');
  let filters: ControlFilters = parseControlFilters(location.search);
  let opener: HTMLButtonElement | null = null;

  const apply = () => {
    let shown = 0;
    for (const row of table.querySelectorAll<HTMLTableRowElement>('[data-cm-row]')) {
      const visible = rowVisible(
        { bu: row.dataset.bu ?? '', teams: (row.dataset.teams ?? '').split(' ').filter(Boolean) },
        filters,
      );
      row.hidden = !visible;
      if (visible) shown++;
    }
    for (const group of table.querySelectorAll<HTMLElement>('[data-cm-group]'))
      group.hidden = !group.querySelector('[data-cm-row]:not([hidden])');
    for (const el of table.querySelectorAll<HTMLElement>('[data-area]'))
      el.hidden = filters.area !== null && el.dataset.area !== filters.area;
    if (empty) empty.hidden = shown > 0;
    if (teamLine) {
      teamLine.hidden = filters.teams.length === 0;
      const name = teamLine.querySelector('[data-cm-team-name]');
      if (name) name.textContent = filters.teams.join(', ');
    }
  };

  for (const s of selects) {
    const key = s.dataset.cmFilter as 'bu' | 'area';
    s.value = filters[key] ?? '';
    s.addEventListener('change', () => {
      const q = new URLSearchParams(location.search);
      if (s.value) q.set(key, s.value);
      else q.delete(key);
      const search = q.toString();
      history.replaceState(
        null,
        '',
        `${location.pathname}${search ? `?${search}` : ''}${location.hash}`,
      );
      filters = parseControlFilters(location.search);
      apply();
    });
  }

  table.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('[data-cm-cell]');
    if (!btn) return;
    const tpl = document.getElementById(btn.dataset.cmCell ?? '');
    if (!(tpl instanceof HTMLTemplateElement)) return;
    opener?.removeAttribute('aria-pressed');
    opener = btn;
    btn.setAttribute('aria-pressed', 'true');
    body.replaceChildren(tpl.content.cloneNode(true));
    panel.focus();
    panel.scrollIntoView({ block: 'nearest' });
  });

  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && opener) opener.focus();
  });

  apply();
}
