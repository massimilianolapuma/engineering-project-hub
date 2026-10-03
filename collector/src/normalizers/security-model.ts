import {
  NATIVE_CONTROLS,
  SecurityStatusFileSchema,
  type ControlId,
  type ControlState,
  type ControlStatus,
  type ErrorClassification,
  type ProjectConfig,
  type RepositoryControls,
  type SecurityFinding,
  type SecurityStatusFile,
  type SeverityCounts,
} from '@model/index';
import type { RepoData } from '../collectors/collect';
import type { ProviderResult } from '../providers/types';
import { scrubIdentifier, scrubText } from '../sanitizers/sanitize';
import { ageMs, DAY_MS } from '../util/clock';
import { codeScanningSeverity, normaliseSeverity, normaliseStatus } from './security';
import { link, pushError, recordError, type BuildContext } from './model';

function isPublicDetail(ctx: BuildContext, data: RepoData): boolean {
  if (ctx.policies.publication.audience === 'restricted') return true;
  return data.repo.ok && data.repo.data.visibility === 'public';
}

function classification(data: RepoData): {
  repositoryPrivate: boolean | null;
  dataClassification: SecurityFinding['dataClassification'];
} {
  if (!data.repo.ok) return { repositoryPrivate: null, dataClassification: 'restricted' };
  const v = data.repo.data.visibility;
  return {
    repositoryPrivate: v !== 'public',
    dataClassification: v === 'public' ? 'public' : 'internal',
  };
}

/** Builds sanitised findings for one repository. Details of non-public repos may be withheld. */
export function toFindings(
  ctx: BuildContext,
  data: RepoData,
  /** Monorepos: maps the alert's file path to the component owning that directory. */
  componentOf: (path: string | null | undefined) => string = () => data.componentId,
): { findings: SecurityFinding[]; withheld: boolean } {
  const findings: SecurityFinding[] = [];
  const reveal = isPublicDetail(ctx, data);
  const cls = classification(data);
  const common = {
    projectId: ctx.projectId,
    componentId: data.componentId,
    repository: data.repository,
    ...cls,
  };

  if (data.codeScanning.ok) {
    for (const a of data.codeScanning.data) {
      const sev = codeScanningSeverity(a.securitySeverityLevel, a.ruleSeverity);
      findings.push({
        ...common,
        componentId: componentOf(a.path),
        id: `${data.repository}#code-scanning#${a.number}`,
        source: 'github-code-scanning',
        category: 'code',
        severity: sev.severity,
        originalSeverity: scrubIdentifier(sev.original, 50),
        status: normaliseStatus(a.state, a.dismissedReason),
        originalStatus: scrubIdentifier(a.state, 50),
        ruleId: reveal ? scrubIdentifier(a.ruleId, 200) : null,
        title: reveal ? scrubText(a.ruleDescription, 160) : null,
        detectedAt: a.createdAt,
        updatedAt: a.updatedAt,
        fixAvailable: null, // not declared by the code scanning API
        htmlUrl: link(ctx, a.htmlUrl),
        tool: scrubIdentifier(a.toolName, 50),
      });
    }
  }
  if (data.dependabot.ok) {
    for (const a of data.dependabot.data) {
      const title = [a.packageName, a.summary].filter(Boolean).join(': ');
      findings.push({
        ...common,
        componentId: componentOf(a.manifestPath),
        id: `${data.repository}#dependabot#${a.number}`,
        source: 'github-dependabot',
        category: 'dependency',
        severity: normaliseSeverity(a.severity),
        originalSeverity: scrubIdentifier(a.severity, 50),
        status: normaliseStatus(a.state, a.dismissedReason),
        originalStatus: scrubIdentifier(a.state, 50),
        ruleId: reveal ? scrubIdentifier(a.ghsaId ?? a.cveId, 200) : null,
        title: reveal ? scrubText(title, 160) : null,
        detectedAt: a.createdAt,
        updatedAt: a.updatedAt,
        fixAvailable: a.firstPatchedVersion !== null,
        htmlUrl: link(ctx, a.htmlUrl),
        tool: 'dependabot',
      });
    }
  }
  if (data.secretScanning.ok) {
    for (const a of data.secretScanning.data) {
      // Only the secret *type* is published: never the value, location, file or commit.
      findings.push({
        ...common,
        id: `${data.repository}#secret-scanning#${a.number}`,
        source: 'github-secret-scanning',
        category: 'secret',
        severity: 'unknown',
        originalSeverity: null,
        status: normaliseStatus(a.state, a.resolution),
        originalStatus: scrubIdentifier(a.state, 50),
        ruleId: null,
        title: reveal ? scrubText(a.secretTypeDisplayName, 100) : null,
        detectedAt: a.createdAt,
        updatedAt: a.updatedAt,
        fixAvailable: null,
        htmlUrl: link(ctx, a.htmlUrl),
        tool: 'secret-scanning',
      });
    }
  }
  return { findings, withheld: !reveal && findings.length > 0 };
}

export function emptyCounts(value: number | null = 0): SeverityCounts {
  return {
    critical: value,
    high: value,
    medium: value,
    low: value,
    informational: value,
    unknown: value,
  };
}

export function countOpen(findings: SecurityFinding[]): SeverityCounts {
  const c = emptyCounts(0) as Record<keyof SeverityCounts, number>;
  for (const f of findings) if (f.status === 'open') c[f.severity]++;
  return c;
}

function stateFromError(c: ErrorClassification, skipped = false): ControlState {
  // Repository not accessible: nothing was asked, so the control is simply unknown.
  if (skipped) return c === 'not-authorised' ? 'not-authorised' : 'unknown';
  switch (c) {
    case 'not-configured':
      return 'not-configured';
    case 'not-authorised':
      return 'not-authorised';
    case 'rate-limited':
    case 'error':
      return 'collection-failed';
    default:
      return 'unknown'; // not-found on a security endpoint is ambiguous; invalid-data
  }
}

export type ParsedStatusFile =
  | { status: 'ok'; file: SecurityStatusFile }
  | {
      status: 'missing' | 'invalid' | 'unavailable';
      file: null;
      classification?: ErrorClassification;
      skipped?: boolean;
    };

export function parseStatusFile(ctx: BuildContext, data: RepoData): ParsedStatusFile {
  const r = data.securityStatusFile;
  if (!r.ok) {
    if (r.error.classification === 'not-found') return { status: 'missing', file: null };
    return {
      status: 'unavailable',
      file: null,
      classification: r.error.classification,
      skipped: r.error.skipped === true,
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(r.data.text);
  } catch {
    pushError(ctx, data.repository, data.componentId, 'security-status-file', {
      classification: 'invalid-data',
      message: 'security status file is not valid JSON',
    });
    return { status: 'invalid', file: null };
  }
  const parsed = SecurityStatusFileSchema.safeParse(json);
  if (!parsed.success) {
    pushError(ctx, data.repository, data.componentId, 'security-status-file', {
      classification: 'invalid-data',
      message: `security status file does not match contract 1.0 (${parsed.error.issues.length} issue(s))`,
    });
    return { status: 'invalid', file: null };
  }
  if (parsed.data.repository.toLowerCase() !== data.repository.toLowerCase()) {
    pushError(ctx, data.repository, data.componentId, 'security-status-file', {
      classification: 'invalid-data',
      message: 'security status file declares a different repository',
    });
    return { status: 'invalid', file: null };
  }
  return { status: 'ok', file: parsed.data };
}

const EXTERNAL_STATE: Record<string, ControlState> = {
  completed: 'enabled',
  available: 'enabled',
  verified: 'enabled',
  failed: 'failed',
  'not-verified': 'failed',
  'not-configured': 'not-configured',
  'not-run': 'configured-not-run',
  running: 'configured-not-run',
};

function nativeControl(
  ctx: BuildContext,
  control: ControlId,
  required: boolean,
  result: ProviderResult<unknown>,
  findings: SecurityFinding[],
  lastScanAt: string | null,
): ControlStatus {
  const base = { control, required, tool: null, reportUrl: null };
  if (!result.ok)
    return {
      ...base,
      state: stateFromError(result.error.classification, result.error.skipped === true),
      lastScanAt: null,
      counts: null,
    };
  let state: ControlState = 'enabled';
  if (control === 'codeScanning') {
    if (!lastScanAt) state = 'configured-not-run';
    else {
      const age = ageMs(lastScanAt, ctx.now);
      if (age !== null && age > ctx.policies.freshness.securityScanStaleDays * DAY_MS)
        state = 'stale';
    }
  }
  return { ...base, state, lastScanAt, counts: countOpen(findings) };
}

export function toRepositoryControls(
  ctx: BuildContext,
  project: ProjectConfig,
  data: RepoData,
  findings: SecurityFinding[],
  statusFile: ParsedStatusFile,
): RepositoryControls {
  const notApplicable = new Set<ControlId>(
    data.componentId === 'coordinator'
      ? project.coordinator.notApplicableControls
      : (project.components.find((c) => c.id === data.componentId)?.notApplicableControls ?? []),
  );
  const analysis = data.codeScanningAnalysis.ok ? data.codeScanningAnalysis.data : null;
  const bySource = (s: SecurityFinding['source']) => findings.filter((f) => f.source === s);

  const controls: ControlStatus[] = (Object.keys(project.securityControls) as ControlId[]).map(
    (control) => {
      const required = project.securityControls[control].required;
      if (notApplicable.has(control)) {
        return {
          control,
          required: false,
          state: 'not-applicable',
          tool: null,
          lastScanAt: null,
          counts: null,
          reportUrl: null,
        };
      }
      switch (control) {
        case 'codeScanning':
          return nativeControl(
            ctx,
            control,
            required,
            data.codeScanning,
            bySource('github-code-scanning'),
            analysis?.createdAt ?? null,
          );
        case 'dependabot':
          return nativeControl(
            ctx,
            control,
            required,
            data.dependabot,
            bySource('github-dependabot'),
            null,
          );
        case 'secretScanning':
          return nativeControl(
            ctx,
            control,
            required,
            data.secretScanning,
            bySource('github-secret-scanning'),
            null,
          );
        default:
          return externalControl(ctx, control, required, statusFile);
      }
    },
  );
  return { componentId: data.componentId, repository: data.repository, controls };
}

function externalControl(
  ctx: BuildContext,
  control: ControlId,
  required: boolean,
  statusFile: ParsedStatusFile,
): ControlStatus {
  const base = { control, required, tool: null, lastScanAt: null, counts: null, reportUrl: null };
  if (statusFile.status === 'missing') return { ...base, state: 'not-configured' };
  if (statusFile.status === 'unavailable')
    return {
      ...base,
      state: stateFromError(statusFile.classification ?? 'error', statusFile.skipped === true),
    };
  if (statusFile.status !== 'ok') return { ...base, state: 'unknown' }; // invalid file
  const file = statusFile.file;
  const entry = file.controls[control as keyof SecurityStatusFile['controls']];
  if (!entry) return { ...base, state: 'not-configured' };
  let state = EXTERNAL_STATE[entry.status] ?? 'unknown';
  const lastScanAt = ('completedAt' in entry && entry.completedAt) || file.generatedAt;
  const age = ageMs(lastScanAt, ctx.now);
  if (
    state === 'enabled' &&
    age !== null &&
    age > ctx.policies.freshness.securityStatusFileStaleDays * DAY_MS
  )
    state = 'stale';
  const reported = pickCounts(entry);
  const counts: SeverityCounts | null = Object.keys(reported).length
    ? { ...emptyCounts(0), ...reported }
    : null;
  return {
    control,
    required,
    state,
    tool: 'tool' in entry ? scrubIdentifier(entry.tool, 50) : null,
    lastScanAt,
    counts,
    reportUrl: 'reportUrl' in entry ? link(ctx, entry.reportUrl) : null,
  };
}

function pickCounts(entry: object): Partial<SeverityCounts> {
  const out: Partial<SeverityCounts> = {};
  for (const k of ['critical', 'high', 'medium', 'low'] as const) {
    const v = (entry as Record<string, unknown>)[k];
    if (typeof v === 'number') out[k] = v;
  }
  return out;
}

/** Records security collection errors (ambiguous 404s included: they hide data). */
export function recordSecurityErrors(ctx: BuildContext, data: RepoData): void {
  if (!data.repo.ok) return; // already reported once as a repository error
  recordError(ctx, data.repository, data.componentId, 'code-scanning', data.codeScanning);
  recordError(ctx, data.repository, data.componentId, 'dependabot', data.dependabot);
  recordError(ctx, data.repository, data.componentId, 'secret-scanning', data.secretScanning);
  recordError(
    ctx,
    data.repository,
    data.componentId,
    'security-status-file',
    data.securityStatusFile,
    { expectedNotFound: true },
  );
}

export const NATIVE = new Set<ControlId>(NATIVE_CONTROLS);
