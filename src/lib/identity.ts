/**
 * Signed-in user from Cloudflare Access (`/cdn-cgi/access/get-identity`), for the optional
 * header slot. Only a display name and its initials are kept: no avatar, no email shown.
 * Anything unexpected (an HTML login page, an empty or odd body) yields null.
 */
export interface Identity {
  name: string;
  initials: string;
}

const MAX_NAME = 64;

export function parseIdentity(body: unknown): Identity | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { name, email } = body as { name?: unknown; email?: unknown };
  let display = typeof name === 'string' ? name.trim() : '';
  if (!display && typeof email === 'string') display = email.split('@')[0]!.trim();
  if (!display) return null;
  display = display.slice(0, MAX_NAME);
  const initials = display
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join('');
  return initials ? { name: display, initials } : null;
}
