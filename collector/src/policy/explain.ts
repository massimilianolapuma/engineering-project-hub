import type { Reason, ReasonCode } from '@model/index';

/*
 * Which policy key sets the level of each Security reason. Static on purpose: it is the
 * documentation `policy:check` prints next to every decision.
 */

const INFORMATIVE = '(informative)';

export const REASON_POLICY_KEY: Partial<Record<ReasonCode, string>> = {
  'open-critical-alerts': 'security.redOnSeverities',
  'open-high-alerts': 'security.redOnSeverities / security.amberOnSeverities',
  'open-medium-low-alerts': 'security.amberOnSeverities',
  'open-secret-alerts': 'security.openSecretAlertIsRed',
  'required-control-failed': 'security.requiredControlFailedIsRed',
  'required-control-stale': 'security.staleScanIsAmber',
  'coverage-incomplete': 'security.incompleteCoverageIsAmber',
  'security-data-unavailable': '(fixed: an unreadable source makes counts a lower bound)',
  'private-details-withheld': INFORMATIVE,
  'no-open-alerts': INFORMATIVE,
  'sla-overdue': 'remediation.overdue.<severity>',
  'sla-age-unknown': INFORMATIVE,
  'security-exception-active': INFORMATIVE,
  'security-exception-expired': 'exceptions.expiredIsAmber',
  'security-exception-stale': INFORMATIVE,
  'security-exception-unverifiable': INFORMATIVE,
  'dimension-red': 'overall.criticalDimensions',
  'dimension-amber': '(fixed: any amber dimension)',
  'dimension-grey': 'overall.greyRequiredDimension',
  'all-dimensions-green': INFORMATIVE,
};

/** The policy key behind a reason, with `<severity>` filled in from the reason's own params. */
export function explainReason(r: Reason): string {
  const key = REASON_POLICY_KEY[r.code] ?? INFORMATIVE;
  return key.replace('<severity>', String(r.params.severity ?? '<severity>'));
}
