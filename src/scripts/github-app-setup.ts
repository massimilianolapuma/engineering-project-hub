/*
 * GitHub App setup page: prepares the manifest POST to github.com and, on the way back, turns
 * GitHub's one-hour code into `gh` commands. The state saved in sessionStorage before leaving
 * must come back unchanged, so a crafted link never shows commands. The code is removed from the
 * address bar and history at once, and never sent anywhere by this page.
 */
import {
  buildManifest,
  conversionCommands,
  defaultAppName,
  formAction,
  parseReturn,
  validAppName,
  validDeployRepository,
  validOwner,
  type AccountType,
} from '../lib/github-app-manifest';

const STORAGE_KEY = 'hub-app-setup';

interface Saved {
  state: string;
  deployRepository: string | null;
}

function load(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
    return v && typeof v.state === 'string'
      ? { state: v.state, deployRepository: v.deployRepository ?? null }
      : null;
  } catch {
    return null;
  }
}

function save(v: Saved): boolean {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

function forget(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked: nothing saved */
  }
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function showMessage(el: HTMLElement | null, text: string): void {
  if (!el) return;
  el.textContent = text;
  el.hidden = text === '';
}

function handleReturn(root: HTMLElement): void {
  const saved = load();
  const ret = parseReturn(window.location.search, saved?.state ?? null);
  if (ret.kind === 'none') return;
  history.replaceState(null, '', window.location.pathname);
  forget();
  const error = root.querySelector<HTMLElement>('[data-app-return-error]');
  if (ret.kind !== 'code') {
    const msg =
      ret.kind === 'invalid-code' ? root.dataset.msgInvalidCode : root.dataset.msgStateMismatch;
    showMessage(error, msg ?? '');
    return;
  }
  const result = root.querySelector<HTMLElement>('[data-app-result]');
  const pre = root.querySelector<HTMLElement>('[data-app-commands]');
  if (!result || !pre) return;
  pre.textContent = conversionCommands(ret.code, saved?.deployRepository ?? null);
  result.hidden = false;
  root.querySelector<HTMLButtonElement>('[data-app-copy]')?.addEventListener('click', () => {
    void navigator.clipboard?.writeText(pre.textContent ?? '').then(() => {
      showMessage(root.querySelector('[data-app-copy-status]'), root.dataset.msgCopied ?? '');
    });
  });
  result.querySelector('h2')?.setAttribute('tabindex', '-1');
  result.querySelector<HTMLElement>('h2')?.focus();
}

function wireForm(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>('#app-form');
  if (!form) return;
  const owner = form.querySelector<HTMLInputElement>('#app-owner')!;
  const name = form.querySelector<HTMLInputElement>('#app-name')!;
  const repo = form.querySelector<HTMLInputElement>('#app-repo')!;
  const teams = form.querySelector<HTMLInputElement>('#app-teams')!;
  const teamsRow = form.querySelector<HTMLElement>('[data-app-teams-row]');
  const manifest = form.querySelector<HTMLInputElement>('input[name="manifest"]')!;
  const error = form.querySelector<HTMLElement>('[data-app-error]');
  const account = (): AccountType =>
    form.querySelector<HTMLInputElement>('input[name="account"]:checked')?.value === 'user'
      ? 'user'
      : 'organization';

  let nameEdited = false;
  name.addEventListener('input', () => (nameEdited = name.value !== ''));
  owner.addEventListener('input', () => {
    if (!nameEdited) name.value = owner.value.trim() ? defaultAppName(owner.value.trim()) : '';
  });
  form.addEventListener('change', () => {
    if (teamsRow) teamsRow.hidden = account() === 'user';
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const o = owner.value.trim();
    const n = name.value.trim();
    const r = repo.value.trim();
    const invalid: [boolean, HTMLInputElement, string | undefined][] = [
      [!validOwner(o), owner, root.dataset.msgInvalidOwner],
      [!validAppName(n), name, root.dataset.msgInvalidName],
      [r !== '' && !validDeployRepository(r), repo, root.dataset.msgInvalidRepo],
    ];
    for (const [, input] of invalid) input.removeAttribute('aria-invalid');
    const first = invalid.find(([bad]) => bad);
    if (first) {
      first[1].setAttribute('aria-invalid', 'true');
      showMessage(error, first[2] ?? '');
      first[1].focus();
      return;
    }
    const state = randomState();
    if (!save({ state, deployRepository: r || null })) {
      showMessage(error, root.dataset.msgNoStorage ?? '');
      return;
    }
    showMessage(error, '');
    const acc = account();
    manifest.value = JSON.stringify(
      buildManifest({
        account: acc,
        owner: o,
        name: n,
        redirectUrl: `${window.location.origin}${window.location.pathname}`,
        teams: teams.checked,
      }),
    );
    form.action = formAction(acc, o, state);
    form.submit();
  });
}

const root = document.querySelector<HTMLElement>('[data-app-setup]');
if (root) {
  handleReturn(root);
  wireForm(root);
}
