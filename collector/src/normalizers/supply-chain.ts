import {
  NATIVE_CONTROLS,
  type ControlId,
  type Ecosystem,
  type RepositoryControls,
  type SecurityFinding,
  type SeverityCounts,
  type SupplyChain,
  tallyImages,
} from '@model/index';
import { scrubIdentifier } from '../sanitizers/sanitize';
import {
  type AttestationResult,
  type HarborImageResult,
  type ParsedSupplyChainSummary,
  type SbomResult,
} from './control-sources';
import type { BuildContext } from './model';

/*
 * Supply chain section (spec 5.10): what the sources found, per unique repository. Counts and
 * states only: package names, versions, purls and raw documents never reach this module's output.
 */

type RepoEntry = SupplyChain['repositories'][number];
type SbomEntry = RepoEntry['sbom'];
type ImageEntry = RepoEntry['images'][number];
type Verification = ImageEntry['signature'];

/** Everything known about one repository (monorepo components already merged). */
export interface SupplyChainRepoInput {
  componentIds: string[];
  repository: string;
  /** Repository visibility is public: image names may be published under a public audience. */
  publicRepository: boolean;
  sbomDependencyGraph: SbomResult;
  summary: ParsedSupplyChainSummary;
  attestations: AttestationResult;
  harbor: HarborImageResult[];
  tools: RepoEntry['tools'];
  otherTools: string[];
}

export interface SupplyChainInput {
  enabled: boolean;
  repositories: SupplyChainRepoInput[];
}

const MAX_LICENSES = 10;
const MAX_ECOSYSTEMS = 16;
const MAX_IMAGES = 20;
const MAX_TOOLS = 10;
const LICENSE_OPERATORS = new Set(['AND', 'OR', 'WITH']);

// ---------------------------------------------------------------------------------------------
// SBOM
// ---------------------------------------------------------------------------------------------

function topLicenses(
  licenses: { id: string; count: number }[],
  otherLicenses: number,
): Pick<SbomEntry, 'licenses' | 'otherLicenses'> {
  const merged = new Map<string, number>();
  for (const l of licenses) merged.set(l.id, (merged.get(l.id) ?? 0) + l.count);
  const sorted = [...merged].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = sorted.slice(0, MAX_LICENSES);
  const rest = sorted.slice(MAX_LICENSES).reduce((sum, [, n]) => sum + n, 0);
  return {
    licenses: top.map(([id, count]) => ({ id, count })),
    otherLicenses: otherLicenses + rest,
  };
}

function ecosystemList(items: { id: Ecosystem; count: number }[]): SbomEntry['ecosystems'] {
  const merged = new Map<Ecosystem, number>();
  for (const e of items) merged.set(e.id, (merged.get(e.id) ?? 0) + e.count);
  const sorted = [...merged].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (sorted.length <= MAX_ECOSYSTEMS) return sorted.map(([id, count]) => ({ id, count }));
  const head = sorted.slice(0, MAX_ECOSYSTEMS - 1);
  const rest = sorted.slice(MAX_ECOSYSTEMS - 1).reduce((sum, [, n]) => sum + n, 0);
  const other = head.find(([id]) => id === 'other');
  if (other) other[1] += rest;
  else head.push(['other', rest]);
  return head.map(([id, count]) => ({ id, count }));
}

/** Packages whose licence expression holds a flagged SPDX id (case-insensitive). */
function flaggedIn(licenses: { id: string; count: number }[], flagged: readonly string[]): number {
  const set = new Set(flagged.map((f) => f.toLowerCase()));
  if (!set.size) return 0;
  return licenses
    .filter((l) =>
      l.id
        .split(/[\s()]+/)
        .filter((t) => t && !LICENSE_OPERATORS.has(t))
        .some((t) => set.has(t.toLowerCase())),
    )
    .reduce((sum, l) => sum + l.count, 0);
}

const emptySbom = (state: SbomEntry['state'], source: SbomEntry['source'] = null): SbomEntry => ({
  state,
  source,
  format: null,
  specVersion: null,
  generatedAt: null,
  packages: null,
  withoutLicense: null,
  flagged: null,
  licenses: [],
  otherLicenses: 0,
  ecosystems: [],
});

type SbomCandidate = { source: 'supply-chain-summary' | 'dependency-graph'; entry: SbomEntry };

function summarySbom(ctx: BuildContext, input: SupplyChainRepoInput): SbomCandidate {
  const source = 'supply-chain-summary';
  const { summary } = input;
  if (summary.state === 'readable' || summary.state === 'stale') {
    const sbom = summary.summary?.sbom;
    if (!sbom) return { source, entry: emptySbom('not-configured') };
    return {
      source,
      entry: {
        state: 'available',
        source,
        format: sbom.format,
        specVersion: sbom.specVersion,
        generatedAt: summary.generatedAt,
        packages: sbom.packages,
        withoutLicense: sbom.withoutLicense,
        flagged: flaggedIn(sbom.licenses, ctx.policies.supplyChain.sbom.flaggedLicenses),
        ...topLicenses(sbom.licenses, 0),
        ecosystems: ecosystemList(sbom.ecosystems),
      },
    };
  }
  const state: SbomEntry['state'] =
    summary.state === 'off'
      ? 'off'
      : summary.state === 'missing'
        ? 'not-configured'
        : summary.state === 'not-authorised'
          ? 'not-authorised'
          : summary.state === 'invalid'
            ? 'invalid'
            : 'unknown';
  return { source, entry: emptySbom(state) };
}

function graphSbom(dg: SbomResult): SbomCandidate {
  const source = 'dependency-graph';
  if (dg.state === 'available' || dg.state === 'partial') {
    const s = dg.summary;
    return {
      source,
      entry: {
        state: dg.state,
        source,
        format: s.format,
        specVersion: s.specVersion,
        generatedAt: s.generatedAt,
        packages: s.packages,
        withoutLicense: s.withoutLicense,
        flagged: s.flagged,
        ...topLicenses(s.licenses, s.otherLicenses),
        ecosystems: ecosystemList(s.ecosystems),
      },
    };
  }
  return { source, entry: emptySbom(dg.state) };
}

/** Lower is better: an answer beats a failure to answer, which beats "not set up", then off. */
function sbomRank(state: SbomEntry['state']): number {
  if (state === 'available' || state === 'partial') return 0;
  if (state === 'not-configured') return 2;
  if (state === 'off') return 3;
  return 1;
}

function sbomEntry(ctx: BuildContext, input: SupplyChainRepoInput): SbomEntry {
  // The order is the owner's precedence for the sbom control.
  const bySource = {
    'supply-chain-summary': summarySbom(ctx, input),
    'dependency-graph': graphSbom(input.sbomDependencyGraph),
  };
  const order = ctx.policies.supplyChain.precedence.sbom.filter(
    (s): s is SbomCandidate['source'] => s === 'supply-chain-summary' || s === 'dependency-graph',
  );
  let best: SbomCandidate | null = null;
  for (const source of order) {
    const c = bySource[source];
    if (!best || sbomRank(c.entry.state) < sbomRank(best.entry.state)) best = c;
  }
  if (!best || best.entry.state === 'off') return emptySbom('off');
  const { state } = best.entry;
  // Only an answer or a pending / failed export names its source; "not set up" names none.
  return { ...best.entry, source: state === 'not-configured' ? null : best.source };
}

// ---------------------------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------------------------

function harborImage(img: HarborImageResult, withhold: boolean): ImageEntry {
  const base = {
    componentId: img.componentId,
    source: 'harbor' as const,
    name: withhold ? null : `${img.project}/${img.repository}`.slice(0, 200),
    tag: img.reference && !img.reference.startsWith('sha256:') ? img.reference.slice(0, 128) : null,
    provenance: 'unknown' as const,
  };
  const unknownScan = (state: 'unknown' | 'not-found' | 'not-authorised') => ({
    state,
    scannedAt: null,
    counts: null,
    fixable: null,
  });
  if (!img.result)
    return { ...base, digest: null, signature: 'unknown', scan: unknownScan('unknown') };
  if (!img.result.ok) {
    const c = img.result.error.classification;
    return {
      ...base,
      digest: null,
      signature: 'unknown',
      scan: unknownScan(
        c === 'not-found' ? 'not-found' : c === 'not-authorised' ? 'not-authorised' : 'unknown',
      ),
    };
  }
  const { digest, scan, signatures } = img.result.data;
  const signature: Verification = signatures.cosign || signatures.notation ? 'present' : 'missing';
  if (!scan || scan.status === 'not-scanned')
    return {
      ...base,
      digest,
      signature,
      scan: { state: 'not-scanned', scannedAt: null, counts: null, fixable: null },
    };
  const state =
    scan.status === 'success'
      ? 'scanned'
      : scan.status === 'error'
        ? 'scan-failed'
        : 'scan-pending';
  const counts: SeverityCounts | null =
    scan.status === 'success' &&
    [scan.critical, scan.high, scan.medium, scan.low, scan.unknown].every((n) => n !== null)
      ? {
          critical: scan.critical,
          high: scan.high,
          medium: scan.medium,
          low: scan.low,
          informational: 0,
          unknown: scan.unknown,
        }
      : null;
  return {
    ...base,
    digest,
    signature,
    scan: { state, scannedAt: scan.endTime, counts, fixable: scan.fixable },
  };
}

function imageRows(ctx: BuildContext, input: SupplyChainRepoInput): ImageEntry[] {
  const withhold = ctx.policies.publication.audience === 'public' && !input.publicRepository;
  const rows: ImageEntry[] = [];
  const { summary } = input;
  if (summary.state === 'readable' || summary.state === 'stale') {
    for (const image of summary.summary?.images ?? []) {
      rows.push({
        componentId: input.componentIds[0]!,
        source: 'supply-chain-summary',
        name: withhold ? null : image.name,
        tag: image.tag ?? null,
        digest: image.digest,
        signature: image.signature?.status ?? 'unknown',
        provenance: image.provenance?.status ?? 'unknown',
        scan: null,
      });
    }
  }
  for (const img of input.harbor) rows.push(harborImage(img, withhold));
  return rows.slice(0, MAX_IMAGES);
}

// ---------------------------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------------------------

const UNKNOWN_SBOM: ReadonlySet<SbomEntry['state']> = new Set([
  'unknown',
  'not-authorised',
  'pending',
  'too-large',
  'invalid',
]);

const UNREADABLE_SUMMARY: ReadonlySet<RepoEntry['summary']['state']> = new Set([
  'not-authorised',
  'unknown',
  'invalid',
  'expired',
]);

const sumKnown = (values: (number | null)[]): number | null => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};

const NULL_TOTALS: SupplyChain['totals'] = {
  repositories: null,
  sbomAvailable: null,
  signedImages: null,
  unsignedImages: null,
  attestedAssets: null,
  flagged: null,
};

export function buildSupplyChain(input: SupplyChainInput, ctx: BuildContext): SupplyChain {
  const collectedAt = ctx.now.toISOString();
  if (!input.enabled)
    return { enabled: false, collectedAt, totals: { ...NULL_TOTALS }, repositories: [] };

  const repositories: RepoEntry[] = input.repositories.map((r) => ({
    componentIds: r.componentIds,
    repository: r.repository,
    sbom: sbomEntry(ctx, r),
    attestations: r.attestations,
    images: imageRows(ctx, r),
    tools: r.tools.slice(0, MAX_TOOLS),
    otherTools: [...new Set(r.otherTools.flatMap((t) => scrubIdentifier(t, 50) ?? []))].slice(
      0,
      MAX_TOOLS,
    ),
    summary: {
      state: r.summary.state,
      generatedAt: r.summary.generatedAt,
      commitSha: r.summary.commitSha,
      runUrl: r.summary.runUrl,
    },
  }));

  const sboms = repositories.map((r) => r.sbom);
  const available = sboms.filter((s) => s.state === 'available' || s.state === 'partial');
  const allUnknown = sboms.length > 0 && sboms.every((s) => UNKNOWN_SBOM.has(s.state));
  // Per repository: the same digest in another repository is a different deployable.
  const tallies = repositories.map((r) => tallyImages(r.images));
  // A CI summary that exists but cannot be read may list images we cannot see: unknown, never 0.
  const imagesUnreadable = repositories.some((r) => UNREADABLE_SUMMARY.has(r.summary.state));
  const signedImages = imagesUnreadable ? null : tallies.reduce((sum, t) => sum + t.signed, 0);
  const unsignedImages = imagesUnreadable ? null : tallies.reduce((sum, t) => sum + t.unsigned, 0);
  const attestations = repositories.map((r) => r.attestations);
  const attested = attestations.filter((a) => a.state === 'available');
  const attestationUnknown = attestations.some(
    (a) => a.state === 'not-authorised' || a.state === 'unknown',
  );
  const attestedAssets = attested.length
    ? attested.reduce((sum, a) => sum + (a.withProvenance ?? 0), 0)
    : attestationUnknown
      ? null
      : 0;

  return {
    enabled: true,
    collectedAt,
    totals: {
      repositories: repositories.length,
      sbomAvailable: allUnknown ? null : available.length,
      signedImages,
      unsignedImages,
      attestedAssets,
      flagged: available.length ? sumKnown(available.map((s) => s.flagged)) : null,
    },
    repositories,
  };
}

// ---------------------------------------------------------------------------------------------
// Security counts
// ---------------------------------------------------------------------------------------------

const KEYS = ['critical', 'high', 'medium', 'low', 'informational', 'unknown'] as const;

/** Finding category of the code-scanning alerts mapped to each scanning control. */
const CONTROL_CATEGORY: Partial<Record<ControlId, SecurityFinding['category']>> = {
  containerScanning: 'container',
  iacScanning: 'iac',
  dast: 'dast',
};

/**
 * Counts reported by the external controls that actually own them: a control won by `harbor` or
 * `status-file`. A control won by `code-scanning` adds nothing (its alerts are already findings),
 * a losing source never adds, and nothing measured stays null (never 0). Whatever the precedence,
 * a control whose mapped tool already has open code-scanning findings in the same repository adds
 * nothing either: the same vulnerabilities are never counted twice.
 */
export function externalCountsFrom(
  controls: RepositoryControls[],
  findings: readonly Pick<SecurityFinding, 'repository' | 'source' | 'category' | 'status'>[] = [],
): SeverityCounts {
  // Only alerts open in GitHub overlap Harbor's open counts: a dismissed or fixed alert must not
  // hide them. An open alert under an accepted exception still overlaps (status, not countsAsOpen).
  const covered = new Set(
    findings
      .filter((f) => f.source === 'github-code-scanning' && f.status === 'open')
      .map((f) => `${f.repository.toLowerCase()}#${f.category}`),
  );
  const total: SeverityCounts = {
    critical: null,
    high: null,
    medium: null,
    low: null,
    informational: null,
    unknown: null,
  };
  for (const rc of controls)
    for (const c of rc.controls) {
      if (NATIVE_CONTROLS.includes(c.control) || c.state === 'not-applicable' || !c.counts)
        continue;
      if (c.source !== 'harbor' && c.source !== 'status-file') continue;
      const category = CONTROL_CATEGORY[c.control];
      if (category && covered.has(`${rc.repository.toLowerCase()}#${category}`)) continue;
      for (const k of KEYS) {
        const v = c.counts[k];
        if (v !== null) total[k] = (total[k] ?? 0) + v;
      }
    }
  return total;
}
