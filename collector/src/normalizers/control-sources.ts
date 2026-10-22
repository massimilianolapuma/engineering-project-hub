import type {
  ControlEvidence,
  ControlId,
  ControlSource,
  ControlState,
  ControlStatus,
  Policies,
  SeverityCounts,
  SupplyChain,
  SupplyChainSummary,
} from '@model/index';
import type { SbomSummary } from './sbom';
import type { HarborArtifactDTO } from '../providers/external/types';
import type {
  CodeScanningAlertDTO,
  CodeScanningAnalysisDTO,
  ProviderError,
  ProviderResult,
} from '../providers/types';
import { scrubIdentifier } from '../sanitizers/sanitize';
import { ageMs, DAY_MS } from '../util/clock';
import { codeScanningSeverity } from './security';
import type { BuildContext } from './model';

/*
 * Control sources (spec 5.1). Every non-native control is resolved from an ordered list of
 * sources. A source answers with a candidate (a control state plus where it comes from); the
 * first definitive candidate wins. Pure functions: the data they read is collected elsewhere.
 */

/** A source's answer for one control. `off` = the source is disabled or not asked: skipped. */
export interface ControlCandidate {
  source: ControlSource;
  state: ControlState | 'off';
  evidence: ControlEvidence | null;
  tool: string | null;
  lastScanAt: string | null;
  counts: SeverityCounts | null;
  reportUrl: string | null;
}

/** State of the dependency-graph SBOM export of one repository. */
export type SbomResult =
  | { state: 'off' }
  | { state: 'available' | 'partial'; summary: SbomSummary }
  | {
      state: 'not-configured' | 'not-authorised' | 'pending' | 'too-large' | 'invalid' | 'unknown';
    };

/** `hub-supply-chain-summary` of a repository after validation (summary only when usable). */
export interface ParsedSupplyChainSummary {
  state:
    'readable' | 'stale' | 'missing' | 'expired' | 'invalid' | 'not-authorised' | 'unknown' | 'off';
  summary: SupplyChainSummary | null;
  generatedAt: string | null;
  commitSha: string | null;
  runUrl: string | null;
}

/** Attestation presence of the latest release's assets (same shape as the published section). */
export type AttestationResult = SupplyChain['repositories'][number]['attestations'];

/** One mapped Harbor image. `result` is null when it was not asked (version unknown). */
export interface HarborImageResult {
  componentId: string;
  project: string;
  repository: string;
  reference: string | null;
  result: ProviderResult<HarborArtifactDTO> | null;
}

/** Everything the supply-chain sources know about one repository. */
export interface SupplyEvidence {
  /** Code-scanning analyses by lower-case tool name; null = not collected. */
  analyses: Map<string, ProviderResult<CodeScanningAnalysisDTO[]>> | null;
  /** Code-scanning alerts; null = unreadable. */
  alerts: CodeScanningAlertDTO[] | null;
  summary: ParsedSupplyChainSummary;
  sbom: SbomResult;
  attestations: AttestationResult;
  harbor: HarborImageResult[];
}

export const NO_SUPPLY_EVIDENCE: SupplyEvidence = {
  analyses: null,
  alerts: null,
  summary: { state: 'off', summary: null, generatedAt: null, commitSha: null, runUrl: null },
  sbom: { state: 'off' },
  attestations: {
    state: 'off',
    release: null,
    checked: 0,
    withProvenance: null,
    withSbom: null,
    withoutDigest: 0,
  },
  harbor: [],
};

const DEFINITIVE: ReadonlySet<ControlCandidate['state']> = new Set(['enabled', 'stale', 'failed']);
const NON_ANSWER: ReadonlySet<ControlCandidate['state']> = new Set([
  'not-authorised',
  'collection-failed',
  'unknown',
  'configured-not-run',
]);

/**
 * Spec 5.1, steps 1 to 4: the first definitive candidate (enabled, stale, failed) wins; else the
 * first non-answer (not-authorised, collection-failed, unknown, configured-not-run); else
 * not-configured with no source. Off candidates are skipped, never evidence of "not set up".
 * (Step 5, notApplicableControls, belongs to the caller.)
 */
export function resolveControl(
  control: ControlId,
  required: boolean,
  candidates: Partial<Record<ControlSource, ControlCandidate>>,
  order: readonly ControlSource[],
): ControlStatus {
  const present = order.flatMap((s) => {
    const c = candidates[s];
    return c && c.state !== 'off' ? [c] : [];
  });
  const winner =
    present.find((c) => DEFINITIVE.has(c.state)) ?? present.find((c) => NON_ANSWER.has(c.state));
  if (!winner) {
    return {
      control,
      required,
      state: 'not-configured',
      tool: null,
      lastScanAt: null,
      counts: null,
      reportUrl: null,
      source: null,
      evidence: null,
    };
  }
  return {
    control,
    required,
    state: winner.state as ControlState,
    tool: winner.tool,
    lastScanAt: winner.lastScanAt,
    counts: winner.counts,
    reportUrl: winner.reportUrl,
    source: winner.source,
    evidence: DEFINITIVE.has(winner.state) ? winner.evidence : null,
  };
}

export const zeroCounts = (): { [K in keyof SeverityCounts]: number } => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  informational: 0,
  unknown: 0,
});

const OFF = (source: ControlSource): ControlCandidate => ({
  source,
  state: 'off',
  evidence: null,
  tool: null,
  lastScanAt: null,
  counts: null,
  reportUrl: null,
});

const candidate = (
  source: ControlSource,
  state: ControlCandidate['state'],
  evidence: ControlEvidence | null,
  extra: Partial<ControlCandidate> = {},
): ControlCandidate => ({
  source,
  state,
  evidence,
  tool: null,
  lastScanAt: null,
  counts: null,
  reportUrl: null,
  ...extra,
});

const isStale = (ctx: BuildContext, iso: string | null): boolean => {
  const age = ageMs(iso, ctx.now);
  return age !== null && age > ctx.policies.freshness.securityScanStaleDays * DAY_MS;
};

// ---------------------------------------------------------------------------------------------
// Code scanning tools (Trivy, Checkov, ZAP)
// ---------------------------------------------------------------------------------------------

export type ToolRule = Policies['supplyChain']['toolControls']['containerScanning'][number];

/**
 * Whether a code-scanning tool name (and optional category) matches one of the rules. The tool
 * is compared case-insensitively; a rule's category must be a prefix of the analysis category.
 */
export function matchToolRule(
  rules: readonly ToolRule[],
  toolName: string | null | undefined,
  category: string | null | undefined,
): boolean {
  if (!toolName) return false;
  const tool = toolName.toLowerCase();
  return rules.some(
    (r) =>
      r.tool.toLowerCase() === tool &&
      (r.category === undefined ||
        (category ?? '').toLowerCase().startsWith(r.category.toLowerCase())),
  );
}

function openCountsOf(
  rules: readonly ToolRule[],
  alerts: CodeScanningAlertDTO[] | null,
): SeverityCounts | null {
  if (!alerts) return null;
  const counts = zeroCounts();
  for (const a of alerts) {
    if (a.state !== 'open' || !matchToolRule(rules, a.toolName, a.category)) continue;
    counts[codeScanningSeverity(a.securitySeverityLevel, a.ruleSeverity).severity]++;
  }
  return counts;
}

/**
 * `code-scanning` source: the newest analysis of a mapped tool (within securityScanStaleDays →
 * enabled, older → stale), none → not-configured, 403 → not-authorised, other errors → unknown.
 * The counts are the tool's open alerts, which are already findings: never added again.
 */
export function toolCandidate(
  ctx: BuildContext,
  rules: readonly ToolRule[],
  analyses: SupplyEvidence['analyses'],
  alerts: CodeScanningAlertDTO[] | null,
): ControlCandidate {
  const source = 'code-scanning';
  if (!rules.length || !analyses) return OFF(source);
  let asked = false;
  let denied = false;
  let failed = false;
  const matches: CodeScanningAnalysisDTO[] = [];
  for (const rule of rules) {
    const result = analyses.get(rule.tool.toLowerCase());
    if (!result) continue;
    asked = true;
    if (!result.ok) {
      if (result.error.classification === 'not-authorised') denied = true;
      else failed = true;
      continue;
    }
    for (const a of result.data)
      if (matchToolRule([rule], a.toolName, a.category ?? null)) matches.push(a);
  }
  if (!asked) return OFF(source);
  const newest = matches.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (!newest)
    return candidate(
      source,
      denied ? 'not-authorised' : failed ? 'unknown' : 'not-configured',
      null,
    );
  return candidate(source, isStale(ctx, newest.createdAt) ? 'stale' : 'enabled', 'reported', {
    tool: scrubIdentifier(newest.toolName, 50),
    lastScanAt: newest.createdAt,
    counts: openCountsOf(rules, alerts),
  });
}

/** One row per mapped tool for the published section; tools that were not asked are left out. */
export function toolRows(
  ctx: BuildContext,
  control: 'containerScanning' | 'iacScanning' | 'dast',
  rules: readonly ToolRule[],
  analyses: SupplyEvidence['analyses'],
  alerts: CodeScanningAlertDTO[] | null,
): SupplyChain['repositories'][number]['tools'] {
  return rules.flatMap((rule) => {
    const c = toolCandidate(ctx, [rule], analyses, alerts);
    if (c.state === 'off') return [];
    return [
      {
        control,
        tool: scrubIdentifier(rule.tool, 50) ?? 'unknown',
        state: c.state,
        lastAnalysisAt: c.lastScanAt,
        open: c.counts,
      },
    ];
  });
}

// ---------------------------------------------------------------------------------------------
// Harbor
// ---------------------------------------------------------------------------------------------

/** Order in which an unreadable image decides the state of the whole control. */
const NON_ANSWER_ORDER: ControlState[] = [
  'not-authorised',
  'collection-failed',
  'unknown',
  'configured-not-run',
];

function errorState(error: ProviderError): ControlState {
  switch (error.classification) {
    case 'not-authorised':
      return 'not-authorised';
    case 'rate-limited':
    case 'error':
      return 'collection-failed';
    default:
      return 'unknown'; // a tag that is not found is ambiguous
  }
}

const worstNonAnswer = (states: ControlState[]): ControlState =>
  NON_ANSWER_ORDER.find((s) => states.includes(s)) ?? 'unknown';

/**
 * `harbor` source for containerScanning. Every mapped image scanned → enabled (stale by the
 * oldest scan end time); any scan Error → failed; Running, Pending or not scanned →
 * configured-not-run; 401/403 → not-authorised; a missing tag → unknown. Counts are the sum of
 * the scanned images: unknown unless every image was scanned.
 */
export function harborContainerCandidate(
  ctx: BuildContext,
  images: HarborImageResult[],
): ControlCandidate {
  const source = 'harbor';
  if (!images.length) return OFF(source);
  const scans: NonNullable<HarborArtifactDTO['scan']>[] = [];
  const open: ControlState[] = [];
  let failed = false;
  for (const img of images) {
    if (!img.result) open.push('unknown');
    else if (!img.result.ok) open.push(errorState(img.result.error));
    else {
      const scan = img.result.data.scan;
      if (scan?.status === 'success') scans.push(scan);
      else if (scan?.status === 'error') failed = true;
      else open.push('configured-not-run');
    }
  }
  if (failed) return candidate(source, 'failed', 'reported', { tool: 'Harbor' });
  if (open.length) return candidate(source, worstNonAnswer(open), null, { tool: 'Harbor' });
  const counts = zeroCounts();
  let oldest: string | null = null;
  for (const s of scans) {
    counts.critical += s.critical ?? 0;
    counts.high += s.high ?? 0;
    counts.medium += s.medium ?? 0;
    counts.low += s.low ?? 0;
    counts.unknown += s.unknown ?? 0;
    if (s.endTime && (!oldest || Date.parse(s.endTime) < Date.parse(oldest))) oldest = s.endTime;
  }
  return candidate(source, isStale(ctx, oldest) ? 'stale' : 'enabled', 'reported', {
    tool: 'Harbor',
    lastScanAt: oldest,
    counts,
  });
}

// ---------------------------------------------------------------------------------------------
// SBOM
// ---------------------------------------------------------------------------------------------

type SummaryState = ParsedSupplyChainSummary['state'];

/** Summary states as for hub-quality-summary: missing is "not set up", the rest unknown. */
function summaryNonAnswer(state: SummaryState): ControlCandidate['state'] {
  switch (state) {
    case 'off':
      return 'off';
    case 'missing':
      return 'not-configured';
    case 'not-authorised':
      return 'not-authorised';
    default:
      return 'unknown';
  }
}

export function sbomCandidates(
  _ctx: BuildContext,
  summary: ParsedSupplyChainSummary,
  dependencyGraph: SbomResult,
): Record<'supply-chain-summary' | 'dependency-graph', ControlCandidate> {
  const usable = summary.state === 'readable' || summary.state === 'stale';
  const sbom = usable ? summary.summary?.sbom : undefined;
  const fromSummary: ControlCandidate = !usable
    ? candidate('supply-chain-summary', summaryNonAnswer(summary.state), null)
    : !sbom
      ? candidate('supply-chain-summary', 'not-configured', null)
      : candidate(
          'supply-chain-summary',
          summary.state === 'stale' ? 'stale' : 'enabled',
          'reported',
          { tool: scrubIdentifier(sbom.tool, 40), lastScanAt: summary.generatedAt },
        );

  let fromGraph: ControlCandidate;
  switch (dependencyGraph.state) {
    case 'off':
      fromGraph = OFF('dependency-graph');
      break;
    case 'available':
    case 'partial':
      fromGraph = candidate('dependency-graph', 'enabled', 'present', {
        lastScanAt: dependencyGraph.summary.generatedAt,
      });
      break;
    case 'not-configured':
    case 'not-authorised':
      fromGraph = candidate('dependency-graph', dependencyGraph.state, null);
      break;
    default:
      fromGraph = candidate('dependency-graph', 'unknown', null); // pending, too large, invalid
  }
  return { 'supply-chain-summary': fromSummary, 'dependency-graph': fromGraph };
}

// ---------------------------------------------------------------------------------------------
// Artifact signature
// ---------------------------------------------------------------------------------------------

function summarySignature(summary: ParsedSupplyChainSummary): ControlCandidate {
  const source = 'supply-chain-summary';
  if (summary.state !== 'readable' && summary.state !== 'stale')
    return candidate(source, summaryNonAnswer(summary.state), null);
  const images = summary.summary?.images ?? [];
  if (!images.length) return candidate(source, 'not-configured', null);
  const statuses = images.map((i) => i.signature?.status ?? null);
  const tool = images.find((i) => i.signature?.tool)?.signature?.tool ?? null;
  const base = { tool, lastScanAt: summary.generatedAt };
  if (statuses.some((s) => s === 'failed' || s === 'not-verified'))
    return candidate(source, 'failed', 'verified', base);
  if (statuses.some((s) => s === 'missing')) return candidate(source, 'not-configured', null);
  if (statuses.some((s) => s === null)) return candidate(source, 'unknown', null);
  return candidate(source, summary.state === 'stale' ? 'stale' : 'enabled', 'verified', base);
}

function attestationSignature(a: AttestationResult): ControlCandidate {
  const source = 'attestations';
  switch (a.state) {
    case 'off':
    case 'not-applicable':
      return OFF(source);
    case 'not-authorised':
      return candidate(source, 'not-authorised', null);
    case 'unknown':
      return candidate(source, 'unknown', null);
  }
  // Assets with no digest cannot be looked up: unknown, never "unsigned".
  if (a.checked === 0) return candidate(source, a.withoutDigest > 0 ? 'unknown' : 'off', null);
  if (a.withProvenance === null) return candidate(source, 'unknown', null);
  if (a.withProvenance >= a.checked) return candidate(source, 'enabled', 'present');
  return candidate(
    source,
    a.withProvenance === 0 ? 'not-configured' : 'failed',
    a.withProvenance === 0 ? null : 'present',
  );
}

function harborSignature(images: HarborImageResult[]): ControlCandidate {
  const source = 'harbor';
  if (!images.length) return OFF(source);
  const open: ControlState[] = [];
  let signed = 0;
  for (const img of images) {
    if (!img.result) open.push('unknown');
    else if (!img.result.ok) open.push(errorState(img.result.error));
    else if (img.result.data.signatures.cosign || img.result.data.signatures.notation) signed++;
  }
  if (open.length) return candidate(source, worstNonAnswer(open), null);
  if (signed === images.length) return candidate(source, 'enabled', 'present');
  return candidate(
    source,
    signed === 0 ? 'not-configured' : 'failed',
    signed === 0 ? null : 'present',
  );
}

export function signatureCandidates(
  _ctx: BuildContext,
  summary: ParsedSupplyChainSummary,
  attestations: AttestationResult,
  harbor: HarborImageResult[],
): Record<'supply-chain-summary' | 'attestations' | 'harbor', ControlCandidate> {
  return {
    'supply-chain-summary': summarySignature(summary),
    attestations: attestationSignature(attestations),
    harbor: harborSignature(harbor),
  };
}
