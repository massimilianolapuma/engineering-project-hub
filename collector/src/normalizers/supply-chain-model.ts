import { SupplyChainSummarySchema, type CollectionError, type ProjectConfig } from '@model/index';
import type { RawProjectData, RepoData } from '../collectors/collect';
import { fail, type ProviderResult } from '../providers/types';
import { scrubIdentifier } from '../sanitizers/sanitize';
import { ageMs, DAY_MS } from '../util/clock';
import {
  toolRows,
  type AttestationResult,
  type HarborImageResult,
  type ParsedSupplyChainSummary,
  type SbomResult,
  type SupplyEvidence,
} from './control-sources';
import { harborImages, harborKey } from './containers';
import { link, pushError, recordError, type BuildContext } from './model';
import { summariseSpdx } from './sbom';
import type { SupplyChainRepoInput } from './supply-chain';

/*
 * Turns the raw supply-chain data of one repository into the inputs of the control sources and
 * of the published section. Errors are recorded once per unique repository.
 */

const noSummary = (state: ParsedSupplyChainSummary['state']): ParsedSupplyChainSummary => ({
  state,
  summary: null,
  generatedAt: null,
  commitSha: null,
  runUrl: null,
});

const SUMMARY_SOURCE = 'supply-chain-summary' satisfies CollectionError['source'];
const SBOM_SOURCE = 'dependency-sbom' satisfies CollectionError['source'];

/** The `hub-supply-chain-summary` artifact: strict contract, same repository, stale by age. */
export function parseSupplyChainSummary(
  ctx: BuildContext,
  data: RepoData,
): ParsedSupplyChainSummary {
  const result = data.supplyChainSummary;
  if (!result) return noSummary('off');
  if (!result.ok) {
    if (result.error.skipped) return noSummary('unknown');
    recordError(ctx, data.repository, data.componentId, SUMMARY_SOURCE, result, {
      expectedNotFound: true,
    });
    const c = result.error.classification;
    return noSummary(
      c === 'not-found'
        ? 'missing'
        : c === 'not-authorised'
          ? 'not-authorised'
          : c === 'invalid-data'
            ? 'invalid'
            : 'unknown',
    );
  }
  const invalid = (message: string) => {
    pushError(ctx, data.repository, data.componentId, SUMMARY_SOURCE, {
      classification: 'invalid-data',
      message,
    });
    return noSummary('invalid');
  };
  const { summaryText, runUrl } = result.data;
  if (summaryText === null) return noSummary('expired');
  let raw: unknown;
  try {
    raw = JSON.parse(summaryText);
  } catch {
    return invalid('supply-chain-summary.json is not valid JSON');
  }
  const parsed = SupplyChainSummarySchema.safeParse(raw);
  if (!parsed.success) return invalid('supply-chain-summary.json does not match the 1.0 contract');
  const summary = parsed.data;
  if (summary.repository.toLowerCase() !== data.repository.toLowerCase())
    return invalid('supply-chain-summary.json names a different repository');
  const age = ageMs(summary.generatedAt, ctx.now);
  const stale = age !== null && age > ctx.policies.freshness.supplyChainSummaryStaleDays * DAY_MS;
  return {
    state: stale ? 'stale' : 'readable',
    summary,
    generatedAt: summary.generatedAt,
    commitSha: summary.commitSha,
    runUrl: link(ctx, runUrl),
  };
}

/** The dependency-graph export of a repository (never requested = off; pending is unknown, not 0). */
export function parseSbomResult(ctx: BuildContext, data: RepoData): SbomResult {
  const request = data.sbomRequest;
  if (!request) return { state: 'off' };
  const fromError = (result: ProviderResult<unknown>): SbomResult => {
    if (result.ok) return { state: 'unknown' };
    recordError(ctx, data.repository, data.componentId, SBOM_SOURCE, result);
    const { classification, message, skipped } = result.error;
    if (skipped) return { state: 'unknown' };
    if (classification === 'not-configured') return { state: 'not-configured' };
    if (classification === 'not-authorised') return { state: 'not-authorised' };
    if (classification === 'invalid-data' && message === 'SBOM too large')
      return { state: 'too-large' };
    return { state: 'unknown' };
  };
  if (!request.ok) return fromError(request);
  const fetched = data.sbomFetch;
  if (!fetched) return { state: 'unknown' };
  if (!fetched.ok) return fromError(fetched);
  if (fetched.data.state === 'pending') return { state: 'pending' };
  let doc: unknown;
  try {
    doc = JSON.parse(fetched.data.text);
  } catch {
    doc = null;
  }
  const summary = summariseSpdx(doc, ctx.policies.supplyChain.sbom.flaggedLicenses);
  if (!summary) {
    pushError(ctx, data.repository, data.componentId, SBOM_SOURCE, {
      classification: 'invalid-data',
      message: 'SBOM is not a usable SPDX 2 document',
    });
    return { state: 'invalid' };
  }
  return { state: summary.partial ? 'partial' : 'available', summary };
}

const attestationNone = (
  state: AttestationResult['state'],
  extra: Partial<AttestationResult> = {},
): AttestationResult => ({
  state,
  release: null,
  checked: 0,
  withProvenance: null,
  withSbom: null,
  withoutDigest: 0,
  ...extra,
});

/** Attestations of the latest release's assets: presence only, never verified here. */
export function parseAttestations(ctx: BuildContext, data: RepoData): AttestationResult {
  const sc = ctx.policies.supplyChain;
  if (!sc.enabled || !sc.attestations.releaseAssets) return attestationNone('off');
  if (!data.repo.ok) return attestationNone('unknown');
  if (!data.release.ok)
    return attestationNone(
      data.release.error.classification === 'not-found' ? 'not-applicable' : 'unknown',
    );
  const release = scrubIdentifier(data.release.data.tagName, 100);
  const assets = data.release.data.assets;
  if (!assets.length) return attestationNone('not-applicable', { release });
  const withoutDigest = assets.filter((a) => a.digest === null).length;
  const results = data.attestations === 'skipped' ? new Map() : data.attestations;
  if (!results.size) return attestationNone('unknown', { release, withoutDigest });
  const failed = [...results.values()].find((r) => !r.ok);
  if (failed && !failed.ok) {
    recordError(ctx, data.repository, data.componentId, 'attestations', failed);
    const denied = [...results.values()].some(
      (r) => !r.ok && r.error.classification === 'not-authorised',
    );
    return attestationNone(denied ? 'not-authorised' : 'unknown', { release, withoutDigest });
  }
  const present = [...results.values()].flatMap((r) => (r.ok ? [r.data] : []));
  const withProvenance = present.filter((p) => p.provenance).length;
  const withSbom = present.filter((p) => p.sbom).length;
  return {
    state: withProvenance > 0 || withSbom > 0 ? 'available' : 'none',
    release,
    checked: present.length,
    withProvenance,
    withSbom,
    withoutDigest,
  };
}

/** Harbor images mapped to the components of one repository, with what Harbor answered. */
export function harborResults(
  ctx: BuildContext,
  config: ProjectConfig,
  raw: RawProjectData,
  versions: ReadonlyMap<string, string | null>,
  repository: string,
): HarborImageResult[] {
  const repoOf = (componentId: string) =>
    (componentId === 'coordinator'
      ? config.coordinator.repository
      : (config.components.find((c) => c.id === componentId)?.repository ?? '')
    ).toLowerCase();
  return harborImages(config, versions)
    .filter((i) => repoOf(i.componentId) === repository.toLowerCase())
    .map((image) => {
      const result = image.reference === null ? null : (raw.harbor?.get(harborKey(image)) ?? null);
      if (result) recordError(ctx, repository, image.componentId, 'harbor', result);
      return {
        componentId: image.componentId,
        project: image.project,
        repository: image.repository,
        reference: image.reference,
        result,
      };
    });
}

/** Everything the control sources and the section need for one unique repository. */
export function supplyEvidence(
  ctx: BuildContext,
  data: RepoData,
  harbor: HarborImageResult[],
): SupplyEvidence {
  return {
    analyses: ctx.policies.supplyChain.enabled ? data.analyses : null,
    alerts: data.codeScanning.ok ? data.codeScanning.data : null,
    summary: parseSupplyChainSummary(ctx, data),
    sbom: parseSbomResult(ctx, data),
    attestations: parseAttestations(ctx, data),
    harbor,
  };
}

/** Tools seen in the alerts that are neither mapped nor CodeQL / Scorecard (names only). */
function otherToolsOf(ctx: BuildContext, alerts: SupplyEvidence['alerts']): string[] {
  if (!alerts) return [];
  const rules = ctx.policies.supplyChain.toolControls;
  const mapped = new Set(
    [...rules.containerScanning, ...rules.iacScanning, ...rules.dast].map((r) =>
      r.tool.toLowerCase(),
    ),
  );
  const known = new Set(['codeql', 'scorecard', 'openssf scorecard']);
  return [
    ...new Set(
      alerts.flatMap((a) =>
        a.toolName && !mapped.has(a.toolName.toLowerCase()) && !known.has(a.toolName.toLowerCase())
          ? [a.toolName]
          : [],
      ),
    ),
  ].sort();
}

export function supplyChainRepoInput(
  ctx: BuildContext,
  componentIds: string[],
  data: RepoData,
  evidence: SupplyEvidence,
): SupplyChainRepoInput {
  const rules = ctx.policies.supplyChain.toolControls;
  return {
    componentIds,
    repository: data.repository,
    publicRepository: data.repo.ok && data.repo.data.visibility === 'public',
    sbomDependencyGraph: evidence.sbom,
    summary: evidence.summary,
    attestations: evidence.attestations,
    harbor: evidence.harbor,
    tools: [
      ...toolRows(
        ctx,
        'containerScanning',
        rules.containerScanning,
        evidence.analyses,
        evidence.alerts,
      ),
      ...toolRows(ctx, 'iacScanning', rules.iacScanning, evidence.analyses, evidence.alerts),
      ...toolRows(ctx, 'dast', rules.dast, evidence.analyses, evidence.alerts),
    ],
    otherTools: otherToolsOf(ctx, evidence.alerts),
  };
}

/** Argo CD errors carry the environment id in the detail (never the application or the host). */
export function recordDeploymentErrors(
  ctx: BuildContext,
  config: ProjectConfig,
  raw: RawProjectData,
): void {
  for (const env of config.environments) {
    const result = raw.argocd?.get(env.id);
    if (!result || result === 'off' || result.ok) continue;
    recordError(
      ctx,
      config.coordinator.repository,
      'coordinator',
      'argocd',
      fail({ ...result.error, message: `environment ${env.id}` }),
    );
  }
}
