import type {
  ComponentSnapshot,
  ControlId,
  ControlState,
  CoverageSummary,
  Dimension,
  EnvironmentSnapshot,
  HealthResult,
  HealthStatus,
  Policies,
  Reason,
  ReasonCode,
  ReasonLevel,
  RepositoryControls,
  RepositoryInfo,
  SecurityFinding,
  SeverityCounts,
  Submodule,
  WorkflowStatus,
} from '@model/index';
import { ageMs, MINUTE_MS } from '../util/clock';

/*
 * Health evaluators. Pure functions over the normalised model, driven by config/policies.yaml.
 * These encode MVP policies, not universal risk ratings. Each result carries the reasons that
 * produced it, so the UI never shows a status without its explanation.
 */

export const reason = (
  code: ReasonCode,
  level: ReasonLevel,
  params: Reason['params'] = {},
): Reason => ({ code, level, params });

/** red > amber > grey > green, reasons decide; `fallback` applies when no reason is red/amber/grey. */
function statusFrom(reasons: Reason[], fallback: HealthStatus = 'green'): HealthStatus {
  if (reasons.some((r) => r.level === 'red')) return 'red';
  if (reasons.some((r) => r.level === 'amber')) return 'amber';
  if (reasons.some((r) => r.level === 'grey')) return 'grey';
  return fallback;
}

// ---------------------------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------------------------

export function evaluateDelivery(
  workflows: WorkflowStatus[],
  policies: Policies,
  now: Date,
): HealthResult {
  const critical = workflows.filter((w) => w.critical);
  const reasons: Reason[] = [];
  if (!critical.length)
    return { status: 'grey', reasons: [reason('no-critical-workflows', 'grey')] };

  let unavailable = 0;
  for (const w of critical) {
    const p = {
      workflow: w.name,
      repository: w.repository,
      component: w.componentId,
      run: w.lastCompletedRun?.runNumber ?? '',
    };
    switch (w.state) {
      case 'failure':
        reasons.push(reason('workflow-failed', policies.delivery.failedCriticalWorkflow, p));
        break;
      case 'cancelled':
        reasons.push(reason('workflow-cancelled', policies.delivery.failedCriticalWorkflow, p));
        break;
      case 'missing':
        reasons.push(
          reason('critical-workflow-missing', policies.delivery.missingCriticalWorkflow, p),
        );
        break;
      case 'never-run':
        reasons.push(
          reason('critical-workflow-never-run', policies.delivery.missingCriticalWorkflow, p),
        );
        break;
      case 'not-authorised':
      case 'unknown':
        unavailable++;
        reasons.push(reason('workflow-data-unavailable', 'grey', p));
        break;
      default:
        break;
    }
    if (w.activeRun) {
      const age = ageMs(w.activeRun.createdAt, now);
      if (age !== null && age > policies.delivery.queuedThresholdMinutes * MINUTE_MS) {
        reasons.push(
          reason('workflow-queued-too-long', 'amber', {
            ...p,
            minutes: Math.round(age / MINUTE_MS),
          }),
        );
      }
    }
    if (w.stale) reasons.push(reason('workflow-stale', 'amber', p));
  }
  for (const w of workflows.filter((x) => !x.critical && x.state === 'failure')) {
    reasons.push(
      reason('non-critical-workflow-failed', 'info', {
        workflow: w.name,
        repository: w.repository,
        component: w.componentId,
      }),
    );
  }
  if (unavailable === critical.length) return { status: 'grey', reasons };
  // Partially unavailable data cannot be green.
  const adjusted = reasons.map((r) =>
    r.code === 'workflow-data-unavailable' ? { ...r, level: 'amber' as const } : r,
  );
  const status = statusFrom(adjusted);
  if (status === 'green')
    adjusted.push(reason('critical-workflows-succeeded', 'info', { count: critical.length }));
  return { status, reasons: adjusted };
}

// ---------------------------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------------------------

export interface VersionInputs {
  coordinatorVersion: string | null;
  manifestState: 'ok' | 'missing' | 'invalid' | 'not-authorised' | 'unknown';
  unknownManifestComponents: string[];
  components: ComponentSnapshot[];
  submodules: Submodule[];
  environments: EnvironmentSnapshot[];
}

export function evaluateVersion(input: VersionInputs, policies: Policies): HealthResult {
  const v = policies.version;
  const reasons: Reason[] = [];
  const anyComponentVersion = input.components.some((c) => c.latestRelease || c.declaredVersion);
  if (!input.coordinatorVersion && !anyComponentVersion) {
    return { status: 'grey', reasons: [reason('coordinator-version-unknown', 'grey')] };
  }
  if (!input.coordinatorVersion) reasons.push(reason('coordinator-version-unknown', 'amber'));
  if (input.manifestState === 'missing') reasons.push(reason('manifest-missing', 'amber'));
  if (input.manifestState === 'invalid') reasons.push(reason('manifest-invalid', 'amber'));
  for (const id of input.unknownManifestComponents) {
    reasons.push(
      reason('manifest-unknown-component', v.unknownManifestComponent, { component: id }),
    );
  }
  for (const s of input.submodules) {
    if (s.association === 'unmapped')
      reasons.push(reason('submodule-unmapped', v.unmappedSubmodule, { path: s.path }));
    else if (s.status === 'unresolvable') {
      reasons.push(
        reason('submodule-unresolvable', v.unresolvableSubmodule, {
          path: s.path,
          component: s.componentId ?? '',
        }),
      );
    }
  }
  for (const c of input.components) {
    if (c.drift === 'drift') {
      reasons.push(
        reason('component-version-drift', v.componentDrift, {
          component: c.name,
          declared: c.declaredVersion ?? '',
          latest: c.latestRelease?.tag ?? '',
        }),
      );
    } else if (c.drift === 'unknown')
      reasons.push(reason('component-version-unknown', 'info', { component: c.name }));
  }
  for (const e of input.environments) {
    const p = {
      environment: e.name,
      version: e.version ?? '',
      expected: input.coordinatorVersion ?? '',
    };
    if (e.status === 'behind') reasons.push(reason('environment-behind', v.environmentBehind, p));
    else if (e.status === 'mismatch')
      reasons.push(reason('environment-mismatch', v.environmentBehind, p));
    else if (e.status === 'unknown') reasons.push(reason('environment-version-unknown', 'info', p));
  }
  const status = statusFrom(reasons);
  if (status === 'green') reasons.push(reason('versions-aligned', 'info'));
  return { status, reasons };
}

// ---------------------------------------------------------------------------------------------
// Security coverage
// ---------------------------------------------------------------------------------------------

/** Worst-first precedence when one control has different states across repositories. */
const STATE_PRECEDENCE: ControlState[] = [
  'failed',
  'collection-failed',
  'not-authorised',
  'unknown',
  'not-configured',
  'configured-not-run',
  'stale',
  'enabled',
  'not-applicable',
];

export function projectControlState(control: ControlId, repos: RepositoryControls[]): ControlState {
  const states = repos.flatMap((r) =>
    r.controls.filter((c) => c.control === control).map((c) => c.state),
  );
  for (const s of STATE_PRECEDENCE) if (states.includes(s)) return s;
  return 'unknown';
}

export function evaluateCoverage(
  requiredControls: ControlId[],
  allControls: ControlId[],
  repos: RepositoryControls[],
  policies: Policies,
  collectedAt: string,
): CoverageSummary {
  const perControl = allControls.map((control) => ({
    control,
    required: requiredControls.includes(control),
    state: projectControlState(control, repos),
  }));
  const required = perControl.filter((c) => c.required && c.state !== 'not-applicable');
  const n = (pred: (s: ControlState) => boolean) => required.filter((c) => pred(c.state)).length;
  const available = n((s) => s === 'enabled');
  const notConfigured = n((s) => s === 'not-configured' || s === 'configured-not-run');
  const notAuthorised = n((s) => s === 'not-authorised');
  const unknown = n((s) => s === 'unknown' || s === 'collection-failed');
  const failed = n((s) => s === 'failed');
  const stale = n((s) => s === 'stale');
  const undeterminable = required.length > 0 && notAuthorised + unknown === required.length;
  // Unknown is never shown as 0%: no percentage when no required control could be read.
  const percentage =
    required.length && !undeterminable ? Math.round((available / required.length) * 100) : null;

  const reasons: Reason[] = [];
  for (const c of required) {
    const p = { control: c.control };
    if (c.state === 'not-configured' || c.state === 'configured-not-run')
      reasons.push(reason('required-control-not-configured', 'amber', p));
    else if (c.state === 'not-authorised')
      reasons.push(reason('required-control-not-authorised', 'amber', p));
    else if (c.state === 'unknown' || c.state === 'collection-failed')
      reasons.push(reason('required-control-unknown', 'amber', p));
    else if (c.state === 'failed') reasons.push(reason('required-control-failed', 'amber', p));
    else if (c.state === 'stale') reasons.push(reason('required-control-stale', 'amber', p));
  }
  let status: HealthStatus;
  if (!required.length) {
    status = 'grey';
    reasons.push(reason('no-required-controls', 'grey'));
  } else if (undeterminable) {
    status = 'grey';
    for (const r of reasons) r.level = 'grey';
  } else if ((percentage ?? 0) >= policies.coverage.greenThresholdPercent && !reasons.length) {
    status = 'green';
    reasons.push(reason('all-required-controls-available', 'info', { count: required.length }));
  } else status = 'amber';

  return {
    status,
    reasons,
    percentage,
    required: required.length,
    available,
    notConfigured,
    notAuthorised,
    unknown,
    failed,
    stale,
    collectedAt,
    perControl,
  };
}

// ---------------------------------------------------------------------------------------------
// Security risk
// ---------------------------------------------------------------------------------------------

export interface SecurityInputs {
  findings: SecurityFinding[];
  repos: RepositoryControls[];
  coverage: CoverageSummary;
  /** Open counts reported by external controls (status file), added to GitHub findings. */
  externalCounts: SeverityCounts;
  /** Any alert source readable at all (otherwise counts are unknown, not zero). */
  anySourceReadable: boolean;
  countsComplete: boolean;
  secretSourceReadable: boolean;
  detailsWithheld: boolean;
}

export function sumCounts(a: SeverityCounts, b: SeverityCounts): SeverityCounts {
  const add = (x: number | null, y: number | null) =>
    x === null && y === null ? null : (x ?? 0) + (y ?? 0);
  return {
    critical: add(a.critical, b.critical),
    high: add(a.high, b.high),
    medium: add(a.medium, b.medium),
    low: add(a.low, b.low),
    informational: add(a.informational, b.informational),
    unknown: add(a.unknown, b.unknown),
  };
}

export function evaluateSecurity(
  input: SecurityInputs,
  openCounts: SeverityCounts,
  openSecretAlerts: number | null,
  policies: Policies,
): HealthResult {
  const s = policies.security;
  const reasons: Reason[] = [];
  const count = (sev: keyof SeverityCounts) => openCounts[sev] ?? 0;

  for (const sev of s.redOnSeverities) {
    if (count(sev) > 0)
      reasons.push(
        reason(sev === 'critical' ? 'open-critical-alerts' : 'open-high-alerts', 'red', {
          count: count(sev),
          severity: sev,
        }),
      );
  }
  if (s.openSecretAlertIsRed && (openSecretAlerts ?? 0) > 0)
    reasons.push(reason('open-secret-alerts', 'red', { count: openSecretAlerts ?? 0 }));
  if (s.requiredControlFailedIsRed) {
    for (const c of input.coverage.perControl.filter((x) => x.required && x.state === 'failed')) {
      reasons.push(reason('required-control-failed', 'red', { control: c.control }));
    }
  }
  if (!reasons.length && !input.anySourceReadable) {
    return { status: 'grey', reasons: [reason('security-data-unavailable', 'grey')] };
  }
  const amberSev = s.amberOnSeverities.filter((x) => !s.redOnSeverities.includes(x));
  const high = amberSev.includes('high') ? count('high') : 0;
  const mediumLow =
    (amberSev.includes('medium') ? count('medium') : 0) +
    (amberSev.includes('low') ? count('low') : 0);
  if (high > 0) reasons.push(reason('open-high-alerts', 'amber', { count: high }));
  if (mediumLow > 0) reasons.push(reason('open-medium-low-alerts', 'amber', { count: mediumLow }));
  if (!s.openSecretAlertIsRed && (openSecretAlerts ?? 0) > 0)
    reasons.push(reason('open-secret-alerts', 'amber', { count: openSecretAlerts ?? 0 }));
  if (s.staleScanIsAmber) {
    for (const c of input.coverage.perControl.filter((x) => x.required && x.state === 'stale')) {
      reasons.push(reason('required-control-stale', 'amber', { control: c.control }));
    }
  }
  if (s.incompleteCoverageIsAmber && input.coverage.status !== 'green') {
    reasons.push(
      reason('coverage-incomplete', 'amber', { percentage: input.coverage.percentage ?? '' }),
    );
  }
  if (!input.countsComplete) reasons.push(reason('security-data-unavailable', 'amber'));
  if (input.detailsWithheld) reasons.push(reason('private-details-withheld', 'info'));
  const status = statusFrom(reasons);
  if (status === 'green') reasons.push(reason('no-open-alerts', 'info'));
  return { status, reasons };
}

// ---------------------------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------------------------

export interface GovernanceRepo {
  componentId: string;
  repository: RepositoryInfo;
  statusFile: 'ok' | 'missing' | 'invalid' | 'unavailable';
  needsStatusFile: boolean;
}

export function evaluateGovernance(
  repos: GovernanceRepo[],
  workflows: WorkflowStatus[],
  policies: Policies,
): HealthResult {
  const g = policies.governance;
  const reasons: Reason[] = [];
  const available = repos.filter((r) => r.repository.status === 'ok');
  if (!available.length)
    return {
      status: 'grey',
      reasons: [reason('repository-unavailable', 'grey', { count: repos.length })],
    };

  for (const r of repos) {
    const p = { repository: r.repository.fullName, component: r.componentId };
    if (r.repository.status !== 'ok') {
      reasons.push(reason('repository-unavailable', 'amber', p));
      continue;
    }
    if (r.repository.archived) reasons.push(reason('repository-archived', g.archivedRepository, p));
    if (
      r.repository.configuredDefaultBranch &&
      r.repository.defaultBranch !== r.repository.configuredDefaultBranch
    ) {
      reasons.push(
        reason('default-branch-mismatch', g.defaultBranchMismatch, {
          ...p,
          expected: r.repository.configuredDefaultBranch,
          actual: r.repository.defaultBranch ?? '',
        }),
      );
    }
    if (r.needsStatusFile && r.statusFile === 'missing')
      reasons.push(reason('security-status-file-missing', g.missingSecurityStatusFile, p));
    if (r.statusFile === 'invalid')
      reasons.push(reason('security-status-file-invalid', g.missingSecurityStatusFile, p));
  }
  for (const w of workflows.filter((x) => x.state === 'missing')) {
    reasons.push(
      reason('standard-workflow-missing', g.missingStandardWorkflow, {
        workflow: w.name,
        file: w.file,
        repository: w.repository,
      }),
    );
  }
  const status = statusFrom(reasons);
  if (status === 'green') reasons.push(reason('governance-compliant', 'info'));
  return { status, reasons };
}

// ---------------------------------------------------------------------------------------------
// Overall
// ---------------------------------------------------------------------------------------------

export function evaluateOverall(
  dimensions: Record<Dimension, HealthStatus>,
  policies: Policies,
): HealthResult {
  const o = policies.overall;
  const reasons: Reason[] = [];
  const entries = Object.entries(dimensions) as [Dimension, HealthStatus][];
  for (const [dimension, status] of entries) {
    if (status === 'red')
      reasons.push(
        reason('dimension-red', o.criticalDimensions.includes(dimension) ? 'red' : 'amber', {
          dimension,
        }),
      );
    else if (status === 'amber') reasons.push(reason('dimension-amber', 'amber', { dimension }));
    else if (status === 'grey' && o.requiredDimensions.includes(dimension)) {
      reasons.push(
        reason('dimension-grey', o.greyRequiredDimension === 'amber' ? 'amber' : 'grey', {
          dimension,
        }),
      );
    }
  }
  const status = statusFrom(reasons);
  if (status === 'green') {
    const allRequiredGreen = o.requiredDimensions.every((d) => dimensions[d] === 'green');
    if (!allRequiredGreen) return { status: 'grey', reasons };
    reasons.push(reason('all-dimensions-green', 'info'));
  }
  return { status, reasons };
}
