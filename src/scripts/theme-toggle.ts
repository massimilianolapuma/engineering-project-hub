/** Cycles the theme Auto → Light → Dark and remembers the choice (UI preference only). */
const btn = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
const order = ['auto', 'light', 'dark'] as const;
type Mode = (typeof order)[number];

function current(): Mode {
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'dark' ? t : 'auto';
}
function render(mode: Mode) {
  if (!btn) return;
  const label = btn.dataset[`label${mode[0]!.toUpperCase()}${mode.slice(1)}`] ?? mode;
  btn.textContent = label;
  btn.setAttribute('aria-label', `${btn.dataset.labelTheme ?? 'Theme'}: ${label}`);
}
btn?.addEventListener('click', () => {
  const next = order[(order.indexOf(current()) + 1) % order.length]!;
  if (next === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  try {
    if (next === 'auto') localStorage.removeItem('eph-theme');
    else localStorage.setItem('eph-theme', next);
  } catch {
    /* ignore */
  }
  render(next);
});
render(current());
