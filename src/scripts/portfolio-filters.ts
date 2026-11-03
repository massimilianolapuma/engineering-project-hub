/**
 * Client-side filtering and sorting of the pre-rendered portfolio list. No network calls.
 * The filter state lives in the URL query (?q=&health=&bu=&sort=&lifecycle=&severity=, plus one
 * team= per selected team), so a filtered view can be shared and survives a reload; the list is
 * filtered on load too. Values from the link are only ever set as text.
 */
import {
  normalizeTeams,
  resultsLine,
  severityMatch,
  teamMatch,
} from '../lib/portfolio-filters-core';
import { scoreSortKey } from '../lib/score';

const form = document.querySelector<HTMLFormElement>('[data-portfolio-filters]');
const tbody = document.querySelector<HTMLTableSectionElement>('[data-portfolio-table] tbody');
const results = document.querySelector<HTMLElement>('[data-results]');
const empty = document.querySelector<HTMLElement>('[data-empty]');
/** Team Labels shown per row before "+N" (as rendered by the page). */
const MAX_ROW_TEAMS = 3;

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

  // Teams: checkboxes in the Team panel, plus link values no project uses ("not in the
  // catalog"), kept so they show as chips and match nothing instead of vanishing.
  const teamBox = form.querySelector<HTMLDetailsElement>('[data-team-filter]');
  const teamBoxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="team"]'));
  const teamCount = form.querySelector<HTMLElement>('[data-team-count]');
  const chipBox = form.querySelector<HTMLElement>('[data-team-chips]');
  const chipTemplate = form.querySelector<HTMLTemplateElement>('template[data-team-chip]');
  let unknownTeams: string[] = [];
  let teamOrder: string[] = [];
  const known = new Set(teamBoxes.map((b) => b.value));
  /** Selected teams in the order they were chosen (link order first). */
  const selectedTeams = () => {
    const checked = teamBoxes.filter((b) => b.checked).map((b) => b.value);
    teamOrder = teamOrder.filter((t) => checked.includes(t) || unknownTeams.includes(t));
    for (const t of [...checked, ...unknownTeams]) if (!teamOrder.includes(t)) teamOrder.push(t);
    return teamOrder;
  };
  const setTeams = (values: string[]) => {
    const wanted = chipBox ? normalizeTeams(values) : [];
    for (const b of teamBoxes) b.checked = wanted.includes(b.value);
    unknownTeams = wanted.filter((t) => !known.has(t));
    teamOrder = wanted;
  };
  const removeTeam = (slug: string) => {
    unknownTeams = unknownTeams.filter((t) => t !== slug);
    for (const b of teamBoxes) if (b.value === slug) b.checked = false;
    apply();
  };
  const renderChips = (teams: string[]) => {
    if (!chipBox || !chipTemplate) return;
    const focused = chipBox.contains(document.activeElement)
      ? Array.from(chipBox.children).indexOf(document.activeElement as Element)
      : -1;
    chipBox.replaceChildren();
    for (const slug of teams) {
      const chip = chipTemplate.content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
      const unknown = !known.has(slug);
      chip.querySelector('.teamchip__name')!.textContent = slug;
      const note = chip.querySelector<HTMLElement>('.teamchip__note')!;
      note.hidden = !unknown;
      note.textContent = unknown ? `· ${chipBox.dataset.unknown ?? ''}` : '';
      chip.classList.toggle('teamchip--unknown', unknown);
      const label = (chipBox.dataset.remove ?? '{name}').replace('{name}', () => slug);
      chip.setAttribute(
        'aria-label',
        unknown ? `${label} (${chipBox.dataset.unknown ?? ''})` : label,
      );
      chip.addEventListener('click', () => {
        const next = chip.nextElementSibling ?? chip.previousElementSibling;
        const nextSlug = next?.querySelector('.teamchip__name')?.textContent ?? null;
        removeTeam(slug);
        // Keep the keyboard where it was: the next chip, else the Team button.
        const target = nextSlug
          ? Array.from(chipBox.querySelectorAll<HTMLElement>('.teamchip')).find(
              (c) => c.querySelector('.teamchip__name')?.textContent === nextSlug,
            )
          : teamBox?.querySelector<HTMLElement>('summary');
        target?.focus();
      });
      chipBox.appendChild(chip);
    }
    chipBox.hidden = teams.length === 0;
    if (focused >= 0)
      (chipBox.children[Math.min(focused, teams.length - 1)] as HTMLElement)?.focus();
    if (teamCount) {
      teamCount.hidden = teams.length === 0;
      teamCount.textContent = teams.length ? String(teams.length) : '';
    }
  };
  /** Row Labels: teams matching the filter first and highlighted; at most 3, then "+N". */
  const renderRowTeams = (r: HTMLTableRowElement, teams: string[]) => {
    const box = r.querySelector<HTMLElement>('[data-row-teams]');
    if (!box) return;
    const labels = Array.from(box.querySelectorAll<HTMLElement>('[data-team-label]'));
    const more = box.querySelector<HTMLElement>('[data-team-more]');
    const isMatch = (l: HTMLElement) => teams.includes(l.dataset.teamLabel ?? '');
    labels
      .sort(
        (a, b) =>
          Number(isMatch(b)) - Number(isMatch(a)) ||
          (a.dataset.teamLabel ?? '').localeCompare(b.dataset.teamLabel ?? ''),
      )
      .forEach((l, i) => {
        l.classList.toggle('teamlabel--match', isMatch(l));
        l.hidden = i >= MAX_ROW_TEAMS;
        box.insertBefore(l, more);
      });
    if (more) {
      more.hidden = labels.length <= MAX_ROW_TEAMS;
      more.textContent = (more.dataset.template ?? '+{n}').replace(
        '{n}',
        String(labels.length - MAX_ROW_TEAMS),
      );
    }
  };

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
    url.searchParams.delete('team');
    for (const t of selectedTeams()) url.searchParams.append('team', t);
    if (url.href !== window.location.href) window.history.replaceState(null, '', url);
  };

  const apply = () => {
    const q = value('q').trim().toLowerCase();
    const health = value('health');
    const bu = value('bu');
    const lifecycle = value('lifecycle');
    const severity = value('severity');
    const sort = value('sort');
    const teams = selectedTeams();
    let shown = 0;
    // Hidden only because their open-alert counts are unknown: never dropped silently.
    let unknownHidden = 0;
    // Hidden by the team filter because they list no team at all.
    let noTeamsHidden = 0;
    for (const r of rows) {
      const d = r.dataset;
      const slugs = (d.teams ?? '').split(' ').filter(Boolean);
      const others =
        (!q || (d.search ?? d.name ?? '').includes(q)) &&
        (!health || d.health === health) &&
        (!bu || d.bu === bu) &&
        (!lifecycle || d.lifecycle === lifecycle);
      const sev = severityMatch(severity, Number(d.critical), Number(d.high));
      const team = teamMatch(teams, slugs);
      const ok = others && sev === 'match' && team;
      r.hidden = !ok;
      if (ok) shown++;
      else if (others && sev === 'unknown' && team) unknownHidden++;
      else if (others && sev === 'match' && !team && slugs.length === 0) noTeamsHidden++;
      renderRowTeams(r, teams);
    }
    renderChips(teams);
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
        noTeamsHidden,
        { one: results.dataset.noteamsOne ?? '', other: results.dataset.noteamsOther ?? '' },
      );
    if (empty) empty.hidden = shown > 0;
    const filtered = !!(q || health || bu || lifecycle || severity || teams.length);
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
    setTeams(params.getAll('team'));
    if (more && (value('lifecycle') || value('severity'))) more.open = true;
    syncFilterbox();
  };

  /** Any field away from its "no filter" value (the sort too: it lives in the same box). */
  const anySet = () =>
    selectedTeams().length > 0 ||
    NAMES.some((n) => (n === 'q' ? value(n).trim() : value(n)) !== FIELDS[n]);
  /** Desktop: always open (its summary is hidden). Phone: open only when a filter is set. */
  const syncFilterbox = () => {
    if (filterbox) filterbox.open = !phone.matches || anySet();
  };

  const clear = () => {
    for (const n of NAMES) setField(n, FIELDS[n]);
    setTeams([]);
    if (teamBox) teamBox.open = false;
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
  // The Team panel closes like a menu: Escape (focus back on its button) or a click outside.
  if (teamBox) {
    teamBox.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !teamBox.open) return;
      teamBox.open = false;
      teamBox.querySelector<HTMLElement>('summary')?.focus();
    });
    document.addEventListener('click', (e) => {
      if (teamBox.open && !teamBox.contains(e.target as Node)) teamBox.open = false;
    });
  }
  readUrl();
  apply();
}
