/**
 * Patterns that must never appear in published output (snapshots, HTML, JS, CSS).
 * Shared by the collector's final sanitisation gate and by scripts/scan-output.ts.
 * Matches are reported by pattern name only: the matched value is never printed.
 */
export interface SecretPattern {
  readonly name: string;
  readonly regex: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9_]{10,}/ },
  { name: 'github-fine-grained-pat', regex: /\bgithub_pat_[A-Za-z0-9_]{10,}/ },
  { name: 'bearer-credential', regex: /\bBearer\s+[A-Za-z0-9\-._~+/]{6,}=*/i },
  { name: 'authorization-header', regex: /\bAuthorization\s*:\s*\S+/i },
  { name: 'private-key', regex: /PRIVATE KEY/ },
  {
    name: 'credential-assignment',
    regex:
      /\b(?:password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret|access[_-]?key)\s*[=:]\s*[^\s&"'<>,;]{3,}/i,
  },
  {
    name: 'credential-json-key',
    // String-valued only: numeric aggregates such as {"secret": 0} are legitimate.
    regex:
      /"(?:password|passwd|secret|token|private_?key|authorization|api_?key|client_?secret)"\s*:\s*"/i,
  },
  { name: 'aws-access-key-id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'slack-token', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'url-embedded-credentials', regex: /https?:\/\/[^\s/:@"'<>]+:[^\s/@"'<>]+@/i },
];

export function findSecretPatterns(text: string): string[] {
  return SECRET_PATTERNS.filter((p) => p.regex.test(text)).map((p) => p.name);
}

/** Exact values of credentials present in the environment (never logged). */
export function sensitiveEnvValues(env: NodeJS.ProcessEnv = process.env): string[] {
  const names = [
    'GH_APP_PRIVATE_KEY',
    'GH_READ_TOKEN',
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'ACTIONS_RUNTIME_TOKEN',
    'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  ];
  return names
    .map((n) => env[n])
    .filter((v): v is string => typeof v === 'string' && v.length >= 8)
    .flatMap((v) => (v.includes('\n') ? v.split('\n').filter((l) => l.trim().length >= 16) : [v]));
}
