const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Builds a request URL from a fixed path template under `base`: every parameter is encoded
 * (twice for the names in `doubleEncode`), the host must stay the base host over https, and any
 * normalisation of the path (dot segments, backslashes) is refused. Errors carry fixed messages,
 * never the URL.
 */
export function buildTemplateUrl(
  base: URL,
  template: string,
  params: Record<string, string>,
  query: Record<string, string> = {},
  doubleEncode: readonly string[] = [],
): URL {
  const basePath = base.pathname.replace(/\/+$/, '');
  const path =
    basePath +
    template.replace(PLACEHOLDER, (_, name: string) => {
      const value = params[name];
      if (value === undefined) throw new Error(`external path parameter "${name}" missing`);
      // "." and ".." are not touched by encodeURIComponent and would be normalised away.
      if (value === '.' || value === '..') throw new Error('external path mismatch');
      const once = encodeURIComponent(value);
      return doubleEncode.includes(name) ? encodeURIComponent(once) : once;
    });
  const url = new URL(path, base.origin);
  if (url.protocol !== 'https:' || url.host !== base.host)
    throw new Error('external host mismatch');
  // Any normalisation (dot segments, backslashes) means the path is not the one intended.
  if (url.pathname !== path) throw new Error('external path mismatch');
  url.search = new URLSearchParams(query).toString();
  return url;
}
