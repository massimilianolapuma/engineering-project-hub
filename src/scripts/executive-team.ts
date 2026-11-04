/**
 * ?team= on the executive summary: recomputes the page for the selected teams' projects from
 * the JSON data blocks the page ships (no fetch). Text only (textContent); the team values are
 * used to match projects and never written into the page.
 */
import type { ExecInput } from '../lib/executive';
import type { ExecStrings } from '../lib/executive-text';
import { teamFilterPlan } from '../lib/executive-filter';

const root = document.querySelector<HTMLElement>('[data-exec]');
const readJson = <T>(id: string): T | null => {
  const el = document.getElementById(id);
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as T;
  } catch {
    return null;
  }
};

const input = readJson<ExecInput>('exec-input');
const strings = readJson<ExecStrings>('exec-strings');
const locale = document.documentElement.lang === 'it' ? 'it' : 'en';
const plan =
  root && input && strings
    ? teamFilterPlan(input, strings, locale, new URLSearchParams(location.search).getAll('team'))
    : null;

if (root && plan) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-slot]')) {
    const value = plan.slots[el.dataset.slot ?? ''];
    if (value !== undefined) el.textContent = value;
  }
  const visible = new Set(plan.visibleRisks);
  for (const li of root.querySelectorAll<HTMLElement>('[data-risk]'))
    li.hidden = !visible.has(li.dataset.risk ?? '');
  const none = root.querySelector<HTMLElement>('[data-risks-none]');
  if (none) none.hidden = visible.size > 0;
  const filter = root.querySelector<HTMLElement>('[data-exec-filter]');
  if (filter) filter.hidden = false;
}
