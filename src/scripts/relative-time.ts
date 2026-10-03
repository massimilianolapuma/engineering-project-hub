/*
 * Relative timestamps and stale indicators, computed in the viewer's browser so a static
 * page that keeps being served still shows the real age of its data. No network calls.
 */
const lang = document.documentElement.lang === 'it' ? 'it' : 'en';
const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
const STALE_LABEL = lang === 'it' ? 'Non aggiornato' : 'Stale';

function relative(iso: string): string {
  const diff = (Date.parse(iso) - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

function isStale(iso: string, hours: number): boolean {
  return Date.now() - Date.parse(iso) > hours * 3_600_000;
}

for (const el of document.querySelectorAll<HTMLTimeElement>('time[data-relative]')) {
  const iso = el.dateTime;
  if (!iso || Number.isNaN(Date.parse(iso))) continue;
  el.textContent = relative(iso);
  const hours = Number(el.dataset.staleHours);
  if (hours > 0 && isStale(iso, hours)) {
    el.classList.add('reltime--stale');
    const tag = document.createElement('span');
    tag.className = 'stale-tag';
    tag.textContent = STALE_LABEL;
    el.after(' ', tag);
  }
}

const banner = document.querySelector<HTMLElement>('[data-stale-banner]');
if (
  banner?.dataset.generated &&
  isStale(banner.dataset.generated, Number(banner.dataset.staleHours) || 24)
) {
  banner.hidden = false;
}
