import { describe, expect, it } from 'vitest';
import type {
  RepositoryControls,
  SecurityFinding,
  SeverityCounts,
  SupplyChainSummary,
} from '@model/index';
import { SupplyChainSchema } from '@model/index';
import type {
  AttestationResult,
  ParsedSupplyChainSummary,
  SbomResult,
} from '../../collector/src/normalizers/control-sources';
import {
  buildSupplyChain,
  externalCountsFrom,
  type SupplyChainRepoInput,
} from '../../collector/src/normalizers/supply-chain';
import type { BuildContext } from '../../collector/src/normalizers/model';
import { emptyCounts } from '../../collector/src/normalizers/security-model';
import { ok, fail } from '../../collector/src/providers/types';
import { daysAgo, NOW, policies } from '../helpers/factories';

const ctx = (over: (p: ReturnType<typeof policies>) => void = () => {}): BuildContext => ({
  projectId: 'p',
  policies: policies(over),
  now: NOW,
  errors: [],
});
const c = (v: Partial<SeverityCounts>): SeverityCounts => ({ ...emptyCounts(0), ...v });

describe('externalCountsFrom', () => {
  const control = (
    controlId: RepositoryControls['controls'][number]['control'],
    source: RepositoryControls['controls'][number]['source'],
    counts: SeverityCounts | null,
    state: RepositoryControls['controls'][number]['state'] = 'enabled',
  ) => ({
    control: controlId,
    required: true,
    state,
    tool: null,
    lastScanAt: null,
    counts,
    reportUrl: null,
    source,
    evidence: null,
  });
  const repo = (...controls: ReturnType<typeof control>[]): RepositoryControls => ({
    componentId: 'a',
    repository: 'o/a',
    controls,
  });

  it('ignores a containerScanning control won by code-scanning (its alerts are already findings)', () => {
    const r = externalCountsFrom([
      repo(control('containerScanning', 'code-scanning', c({ low: 1 }))),
    ]);
    expect(r).toEqual(emptyCounts(null));
  });

  it('adds only the winning harbor counts (0/0/2/6), never the status-file counts (0/0/1/3) of the same control', () => {
    const r = externalCountsFrom([
      repo(control('containerScanning', 'harbor', c({ medium: 2, low: 6 }))),
    ]);
    expect(r).toMatchObject({ critical: 0, high: 0, medium: 2, low: 6 });
  });

  it('status-file counts still add up, native and not-applicable controls are ignored', () => {
    const r = externalCountsFrom([
      repo(
        control('dast', 'status-file', c({ high: 1 })),
        control('iacScanning', 'status-file', c({ high: 2, low: 1 })),
        control('codeScanning', 'github', c({ critical: 9 })),
        control('sbom', null, c({ critical: 9 }), 'not-applicable'),
      ),
    ]);
    expect(r).toMatchObject({ critical: 0, high: 3, low: 1 });
  });

  it('I-1: a control won by Harbor or the status file adds nothing when its mapped tool already has findings in that repository', () => {
    const trivy = (repository: string, category: 'container' | 'iac' | 'code' = 'container') =>
      ({ repository, source: 'github-code-scanning', category, status: 'open' }) as SecurityFinding;
    const controls = [
      repo(
        control('containerScanning', 'harbor', c({ medium: 2, low: 6 })),
        control('iacScanning', 'status-file', c({ high: 1 })),
      ),
    ];
    // Trivy container alerts of o/a are findings: Harbor's counts for o/a would count them twice.
    expect(externalCountsFrom(controls, [trivy('O/A')])).toMatchObject({
      medium: 0,
      low: 0,
      high: 1,
    });
    // Alerts of another repository, or of another category, do not overlap.
    expect(externalCountsFrom(controls, [trivy('o/b'), trivy('o/a', 'code')])).toMatchObject({
      medium: 2,
      low: 6,
      high: 1,
    });
  });

  it('I-1 follow-up: a dismissed or fixed Trivy alert does not drop Harbor open counts', () => {
    const closed = (status: 'dismissed' | 'fixed') =>
      ({
        repository: 'o/a',
        source: 'github-code-scanning',
        category: 'container',
        status,
      }) as SecurityFinding;
    const controls = [repo(control('containerScanning', 'harbor', c({ medium: 2 })))];
    expect(externalCountsFrom(controls, [closed('dismissed'), closed('fixed')])).toMatchObject({
      medium: 2,
    });
  });

  it('nothing measured stays null, never 0', () => {
    expect(externalCountsFrom([repo(control('sbom', null, null, 'not-configured'))])).toEqual(
      emptyCounts(null),
    );
  });
});

describe('buildSupplyChain', () => {
  const NO_SUMMARY: ParsedSupplyChainSummary = {
    state: 'off',
    summary: null,
    generatedAt: null,
    commitSha: null,
    runUrl: null,
  };
  const NO_ATT: AttestationResult = {
    state: 'not-applicable',
    release: null,
    checked: 0,
    withProvenance: null,
    withSbom: null,
    withoutDigest: 0,
  };
  const spdx = (packages: number, flagged = 0): SbomResult => ({
    state: 'available',
    summary: {
      format: 'spdx',
      specVersion: '2.3',
      generatedAt: daysAgo(0),
      packages,
      withoutLicense: 1,
      flagged,
      licenses: [{ id: 'MIT', count: packages - 1 }],
      otherLicenses: 0,
      ecosystems: [{ id: 'maven', count: packages }],
      partial: false,
    },
  });
  const repoInput = (over: Partial<SupplyChainRepoInput> = {}): SupplyChainRepoInput => ({
    componentIds: ['a'],
    repository: 'o/a',
    publicRepository: true,
    sbomDependencyGraph: { state: 'off' },
    summary: NO_SUMMARY,
    attestations: NO_ATT,
    harbor: [],
    tools: [],
    otherTools: [],
    ...over,
  });
  const summaryWith = (over: Partial<SupplyChainSummary>): ParsedSupplyChainSummary => {
    const s: SupplyChainSummary = {
      schemaVersion: '1.0',
      repository: 'o/a',
      ref: 'refs/heads/main',
      commitSha: 'a'.repeat(40),
      generatedAt: daysAgo(1),
      ...over,
    };
    return {
      state: 'readable',
      summary: s,
      generatedAt: s.generatedAt,
      commitSha: s.commitSha,
      runUrl: null,
    };
  };
  const build = (repositories: SupplyChainRepoInput[], x = ctx()) =>
    buildSupplyChain({ enabled: true, repositories }, x);
  const DIGEST = `sha256:${'b'.repeat(64)}`;
  const signed = { status: 'verified' as const, tool: 'cosign' as const };
  const unsigned = { status: 'missing' as const };

  it('monorepo: three components on one repository → one entry with componentIds [coordinator, web, api]', () => {
    const sc = build([
      repoInput({ componentIds: ['coordinator', 'web', 'api'], repository: 'o/mono' }),
    ]);
    expect(sc.repositories).toHaveLength(1);
    expect(sc.repositories[0]!.componentIds).toEqual(['coordinator', 'web', 'api']);
    expect(sc.totals.repositories).toBe(1);
    expect(SupplyChainSchema.safeParse(sc).success).toBe(true);
  });

  it('totals for an alpha-like input: repositories 5, sbomAvailable 3, signedImages 2 (one per digest), unsignedImages 0, attestedAssets 1, flagged 0', () => {
    const harbor = (componentId: string, cosign: boolean, found = true) => ({
      componentId,
      project: 'alpha',
      repository: componentId,
      reference: '1.4.0',
      result: found
        ? ok({ digest: DIGEST, scan: null, signatures: { cosign, notation: false } })
        : fail({ classification: 'not-found' as const }),
    });
    const sc = build([
      repoInput({
        componentIds: ['coordinator'],
        repository: 'o/coord',
        sbomDependencyGraph: spdx(12),
      }),
      repoInput({
        componentIds: ['backend'],
        repository: 'o/backend',
        sbomDependencyGraph: spdx(214),
        attestations: {
          state: 'available',
          release: 'v1.4.0',
          checked: 1,
          withProvenance: 1,
          withSbom: 1,
          withoutDigest: 0,
        },
        summary: summaryWith({
          images: [
            { name: 'example-org/backend', tag: '1.4.0', digest: DIGEST, signature: signed },
          ],
        }),
        harbor: [harbor('backend', true)],
      }),
      repoInput({
        componentIds: ['frontend'],
        repository: 'o/frontend',
        sbomDependencyGraph: { state: 'not-configured' },
        summary: summaryWith({
          sbom: {
            format: 'cyclonedx',
            specVersion: '1.6',
            tool: 'syft',
            packages: 812,
            withoutLicense: 9,
            licenses: [
              { id: 'MIT', count: 800 },
              { id: 'LicenseRef-*', count: 1 },
              { id: 'LicenseRef-*', count: 2 },
            ],
            ecosystems: [{ id: 'npm', count: 812 }],
          },
          images: [
            { name: 'example-org/frontend', tag: '2.1.0', digest: DIGEST, signature: signed },
          ],
        }),
        harbor: [harbor('frontend', false, false)],
      }),
      repoInput({
        componentIds: ['worker'],
        repository: 'o/worker',
        sbomDependencyGraph: { state: 'pending' },
        attestations: {
          state: 'unknown',
          release: 'v1.2.0',
          checked: 0,
          withProvenance: null,
          withSbom: null,
          withoutDigest: 1,
        },
      }),
      repoInput({
        componentIds: ['helm'],
        repository: 'o/helm',
        sbomDependencyGraph: { state: 'not-configured' },
      }),
    ]);
    expect(sc.totals).toEqual({
      repositories: 5,
      sbomAvailable: 3,
      signedImages: 2,
      unsignedImages: 0,
      attestedAssets: 1,
      flagged: 0,
    });
    const frontend = sc.repositories.find((r) => r.repository === 'o/frontend')!;
    expect(frontend.sbom).toMatchObject({
      state: 'available',
      source: 'supply-chain-summary',
      format: 'cyclonedx',
      packages: 812,
      withoutLicense: 9,
    });
    expect(frontend.sbom.licenses).toContainEqual({ id: 'LicenseRef-*', count: 3 });
    const worker = sc.repositories.find((r) => r.repository === 'o/worker')!;
    expect(worker.sbom).toMatchObject({ state: 'pending', packages: null });
    const backend = sc.repositories.find((r) => r.repository === 'o/backend')!;
    expect(backend.sbom).toMatchObject({
      state: 'available',
      source: 'dependency-graph',
      packages: 214,
    });
    expect(backend.images.map((i) => [i.source, i.signature])).toEqual([
      ['supply-chain-summary', 'verified'],
      ['harbor', 'present'],
    ]);
    expect(SupplyChainSchema.safeParse(sc).success).toBe(true);
  });

  it('all unknown → sbomAvailable null, flagged null, attestedAssets null', () => {
    const sc = build([
      repoInput({
        sbomDependencyGraph: { state: 'unknown' },
        attestations: { ...NO_ATT, state: 'not-authorised' },
      }),
      repoInput({ repository: 'o/b', sbomDependencyGraph: { state: 'not-authorised' } }),
    ]);
    expect(sc.totals).toMatchObject({
      repositories: 2,
      sbomAvailable: null,
      flagged: null,
      attestedAssets: null,
    });
  });

  it('I-5: a Harbor scan that succeeded without severities publishes null counts, never zeros', () => {
    const blank = {
      status: 'success' as const,
      endTime: daysAgo(1),
      critical: null,
      high: null,
      medium: null,
      low: null,
      unknown: null,
      fixable: null,
      total: null,
    };
    const sc = build([
      repoInput({
        harbor: [
          {
            componentId: 'a',
            project: 'p',
            repository: 'a',
            reference: '1.0.0',
            result: ok({
              digest: DIGEST,
              scan: blank,
              signatures: { cosign: true, notation: false },
            }),
          },
        ],
      }),
    ]);
    expect(sc.repositories[0]!.images[0]!.scan).toMatchObject({ state: 'scanned', counts: null });
  });

  it('I-3: one image reported by the CI summary and by Harbor (same digest) counts once', () => {
    const sc = build([
      repoInput({
        summary: summaryWith({
          images: [{ name: 'example-org/api', digest: DIGEST, signature: unsigned }],
        }),
        harbor: [
          {
            componentId: 'a',
            project: 'beta',
            repository: 'api',
            reference: '3.1.0',
            result: ok({
              digest: DIGEST,
              scan: null,
              signatures: { cosign: false, notation: false },
            }),
          },
        ],
      }),
      repoInput({
        repository: 'o/b',
        summary: summaryWith({
          images: [
            { name: 'example-org/b', digest: `sha256:${'c'.repeat(64)}`, signature: signed },
          ],
        }),
        harbor: [
          {
            componentId: 'a',
            project: 'beta',
            repository: 'b',
            reference: '1.0.0',
            result: ok({
              digest: `sha256:${'c'.repeat(64)}`,
              scan: null,
              signatures: { cosign: true, notation: false },
            }),
          },
        ],
      }),
    ]);
    expect(sc.repositories[0]!.images).toHaveLength(2); // both sources stay visible
    expect(sc.totals).toMatchObject({ unsignedImages: 1, signedImages: 1 });
  });

  it('beta-like: not configured everywhere → sbomAvailable 0; one unsigned image (two rows, same digest); attestedAssets and flagged null', () => {
    const sc = build([
      repoInput({ sbomDependencyGraph: { state: 'not-configured' } }),
      repoInput({
        repository: 'o/api',
        sbomDependencyGraph: { state: 'not-authorised' },
        attestations: { ...NO_ATT, state: 'not-authorised' },
        summary: summaryWith({
          images: [{ name: 'example-org/api', digest: DIGEST, signature: unsigned }],
        }),
        harbor: [
          {
            componentId: 'api',
            project: 'beta',
            repository: 'api',
            reference: '3.1.0',
            result: ok({
              digest: DIGEST,
              scan: null,
              signatures: { cosign: false, notation: false },
            }),
          },
        ],
      }),
    ]);
    expect(sc.totals).toMatchObject({
      sbomAvailable: 0,
      signedImages: 0,
      unsignedImages: 1,
      attestedAssets: null,
      flagged: null,
    });
  });

  it('platform-like: flagged counted from the export, no release assets → attestedAssets 0', () => {
    const sc = build([repoInput({ sbomDependencyGraph: spdx(1530, 2) })]);
    expect(sc.totals).toMatchObject({ sbomAvailable: 1, attestedAssets: 0, flagged: 2 });
  });

  it('flagged licenses of a CI summary come from the policy list (case-insensitive, expressions included)', () => {
    const sc = build(
      [
        repoInput({
          summary: summaryWith({
            sbom: {
              format: 'cyclonedx',
              specVersion: '1.6',
              tool: 'syft',
              packages: 10,
              withoutLicense: 0,
              licenses: [
                { id: 'MIT', count: 5 },
                { id: 'gpl-3.0-only', count: 2 },
                { id: 'MIT OR AGPL-3.0-only', count: 3 },
              ],
              ecosystems: [],
            },
          }),
        }),
      ],
      ctx((p) => (p.supplyChain.sbom.flaggedLicenses = ['GPL-3.0-only', 'AGPL-3.0-only'])),
    );
    expect(sc.repositories[0]!.sbom.flagged).toBe(5);
    expect(sc.totals.flagged).toBe(5);
  });

  it('public audience + private repo → image name null, digest kept', () => {
    const input = repoInput({
      publicRepository: false,
      summary: summaryWith({
        images: [{ name: 'example-org/secret-app', tag: '1.0', digest: DIGEST, signature: signed }],
      }),
    });
    const sc = build(
      [input],
      ctx((p) => (p.publication.audience = 'public')),
    );
    expect(sc.repositories[0]!.images[0]).toMatchObject({ name: null, digest: DIGEST, tag: '1.0' });
    const restricted = build(
      [input],
      ctx((p) => (p.publication.audience = 'restricted')),
    );
    expect(restricted.repositories[0]!.images[0]!.name).toBe('example-org/secret-app');
    const open = build(
      [{ ...input, publicRepository: true }],
      ctx((p) => (p.publication.audience = 'public')),
    );
    expect(open.repositories[0]!.images[0]!.name).toBe('example-org/secret-app');
  });

  it('top 10 licenses by count (ties by id), the rest summed into otherLicenses; ecosystems folded beyond 16', () => {
    const licenses = Array.from({ length: 14 }, (_, i) => ({
      id: `Lic-${String(i).padStart(2, '0')}`,
      count: 14 - i,
    }));
    const sc = build([
      repoInput({
        summary: summaryWith({
          sbom: {
            format: 'spdx',
            specVersion: '2.3',
            tool: 't',
            packages: 200,
            withoutLicense: 0,
            licenses: licenses.slice(0, 14),
            ecosystems: [],
          },
        }),
      }),
    ]);
    const sbom = sc.repositories[0]!.sbom;
    expect(sbom.licenses).toHaveLength(10);
    expect(sbom.licenses[0]).toEqual({ id: 'Lic-00', count: 14 });
    expect(sbom.otherLicenses).toBe(4 + 3 + 2 + 1);
  });

  it('disabled supply chain: no entries, totals null', () => {
    const sc = buildSupplyChain({ enabled: false, repositories: [repoInput()] }, ctx());
    expect(sc.enabled).toBe(false);
    expect(sc.repositories).toEqual([]);
    expect(Object.values(sc.totals).every((v) => v === null)).toBe(true);
  });

  it('never publishes anything but counts: the entry has no package names', () => {
    const sc = build([repoInput({ sbomDependencyGraph: spdx(10) })]);
    expect(JSON.stringify(sc)).not.toMatch(/canary|purl|pkg:/);
  });
});
