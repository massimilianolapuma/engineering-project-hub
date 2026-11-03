/**
 * Optional "signed in as" slot (builds with PUBLIC_IDENTITY_SOURCE=cloudflare-access only).
 * Asks Cloudflare Access who is signed in and shows their initials; on any failure (no Access,
 * an HTML login page, a 401, a body without a name) the slot simply stays hidden.
 */
import { parseIdentity } from '../lib/identity';

{
  // Block scope: these scripts are not modules, so top-level names would be shared globals.
  const slot = document.querySelector<HTMLElement>('[data-identity]');
  if (slot) {
    fetch('/cdn-cgi/access/get-identity', { credentials: 'same-origin' })
      .then((res) =>
        res.ok && (res.headers.get('content-type') ?? '').includes('application/json')
          ? res.json()
          : null,
      )
      .then((body: unknown) => {
        const who = parseIdentity(body);
        if (!who) return;
        const initials = document.createElement('span');
        initials.className = 'identity__initials';
        initials.setAttribute('aria-hidden', 'true');
        initials.textContent = who.initials;
        const text = document.createElement('span');
        text.className = 'visually-hidden';
        text.textContent = (slot.dataset.label ?? '{name}').replace('{name}', who.name);
        slot.replaceChildren(initials, text);
        slot.title = text.textContent;
        slot.hidden = false;
      })
      .catch(() => {
        /* Access not in front of the site, or the endpoint failed: leave the slot hidden. */
      });
  }
}
