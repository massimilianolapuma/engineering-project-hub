import type { FindingStatus, Severity } from '@model/index';

/**
 * Maps provider severities onto the normalised scale. The original value is always kept
 * next to the normalised one (originalSeverity).
 */
export function normaliseSeverity(raw: string | null | undefined): Severity {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'high':
    case 'error': // code scanning rule severity without security-severity
      return 'high';
    case 'medium':
    case 'moderate': // Dependabot / GitHub advisories
    case 'warning':
      return 'medium';
    case 'low':
      return 'low';
    case 'note':
    case 'info':
    case 'informational':
    case 'none':
      return 'informational';
    default:
      return 'unknown';
  }
}

/** Code scanning: prefer security_severity_level, fall back to the rule severity. */
export function codeScanningSeverity(
  securitySeverityLevel: string | null,
  ruleSeverity: string | null,
): {
  severity: Severity;
  original: string | null;
} {
  if (securitySeverityLevel)
    return { severity: normaliseSeverity(securitySeverityLevel), original: securitySeverityLevel };
  return { severity: normaliseSeverity(ruleSeverity), original: ruleSeverity };
}

/**
 * Maps provider alert states + dismissal reasons onto normalised statuses.
 * GitHub dismissal reasons: code scanning "false positive" | "won't fix" | "used in tests";
 * Dependabot "fix_started" | "inaccurate" | "no_bandwidth" | "not_used" | "tolerable_risk";
 * secret scanning resolution "false_positive" | "wont_fix" | "revoked" | "used_in_tests" | "pattern_*".
 */
export function normaliseStatus(
  state: string | null | undefined,
  reason?: string | null,
): FindingStatus {
  const s = (state ?? '').trim().toLowerCase();
  const r = (reason ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');
  switch (s) {
    case 'open':
      return 'open';
    case 'fixed':
      return 'fixed';
    case 'auto_dismissed':
      return 'dismissed';
    case 'dismissed':
    case 'resolved':
      if (
        r === 'false positive' ||
        r === 'inaccurate' ||
        r === 'pattern edited' ||
        r === 'pattern deleted'
      )
        return 'false-positive';
      if (r === 'revoked') return 'fixed';
      if (
        r === "won't fix" ||
        r === 'wont fix' ||
        r === 'tolerable risk' ||
        r === 'no bandwidth' ||
        r === 'used in tests' ||
        r === 'not used'
      ) {
        return 'accepted-risk';
      }
      return 'dismissed';
    default:
      return 'unknown';
  }
}
