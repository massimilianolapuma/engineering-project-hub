import {
  findSecretPatterns,
  SECRET_PATTERNS,
  sensitiveEnvValues,
} from '../../../shared/security/patterns';

export class SanitizationError extends Error {
  constructor(
    message: string,
    readonly patterns: string[],
  ) {
    super(message);
    this.name = 'SanitizationError';
  }
}

const REDACTED = '[redacted]';
const CODE_REMOVED = '[code removed]';

/**
 * Cleans free text coming from providers (titles, error messages, rule descriptions)
 * before publication: credentials, code, stack traces, headers, query strings and
 * control characters are removed, then the result is truncated.
 */
export function scrubText(input: string | null | undefined, maxLength = 160): string | null {
  if (input === null || input === undefined) return null;
  let s = String(input);
  // Multi-line constructs first: fenced code, PEM blocks, stack frames.
  s = s.replace(/```[\s\S]*?(```|$)/g, ` ${CODE_REMOVED} `);
  s = s.replace(/-----BEGIN [^-]*-----[\s\S]*?(-----END [^-]*-----|$)/g, REDACTED);
  s = s.replace(/^\s*at\s+.+\(.+:\d+:\d+\)\s*$/gm, '');
  s = s.replace(/^\s*at\s+\S+:\d+:\d+\s*$/gm, '');
  s = s.replace(/`[^`\n]{1,200}`/g, CODE_REMOVED);
  // Header-like lines and credentials.
  s = s.replace(
    /\b(authorization|cookie|set-cookie|x-api-key|proxy-authorization)\s*:\s*[^\n]*/gi,
    `$1: ${REDACTED}`,
  );
  for (const { regex } of SECRET_PATTERNS) {
    s = s.replace(
      new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`),
      REDACTED,
    );
  }
  for (const value of sensitiveEnvValues()) s = s.split(value).join(REDACTED);
  // Query strings / fragments in any URL-looking token.
  s = s.replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, '$1');
  // Collapse whitespace and drop control characters.
  s = stripControlChars(s).replace(/\s+/g, ' ').trim();
  if (s.length > maxLength) s = `${s.slice(0, maxLength - 1).trimEnd()}…`;
  return s.length ? s : null;
}

function stripControlChars(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return out;
}

/**
 * Returns a publishable https URL on an allow-listed host, without credentials,
 * query string or fragment; null otherwise.
 */
export function sanitizeUrl(
  input: string | null | undefined,
  allowedHosts: readonly string[],
): string | null {
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (!allowedHosts.some((h) => host === h)) return null;
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  const out = url.toString();
  return out.length <= 500 ? out : null;
}

/** Strings that are identifiers (versions, rule ids, tags): scrub and keep short. */
export function scrubIdentifier(input: string | null | undefined, maxLength = 100): string | null {
  const s = scrubText(input, maxLength);
  return s && !s.includes(REDACTED) ? s : null;
}

/**
 * Final publication gate: the serialised document must not contain any secret pattern
 * or the value of a credential present in the environment.
 */
export function assertPublishable(serialised: string, label: string): void {
  const hits = findSecretPatterns(serialised);
  if (sensitiveEnvValues().some((v) => serialised.includes(v))) hits.push('environment-credential');
  if (hits.length) {
    throw new SanitizationError(
      `Sanitisation gate failed for ${label}: ${[...new Set(hits)].join(', ')}`,
      hits,
    );
  }
}
