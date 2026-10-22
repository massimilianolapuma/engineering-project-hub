import { describe, expect, it } from 'vitest';
import type { ProjectConfig, SupplyChainSummary } from '@model/index';
import {
  harborContainerCandidate,
  matchToolRule,
  NO_SUPPLY_EVIDENCE,
  resolveControl,
  sbomCandidates,
  signatureCandidates,
  toolCandidate,
  type AttestationResult,
  type ControlCandidate,
  type HarborImageResult,
  type ParsedSupplyChainSummary,
  type SbomResult,
} from '../../collector/src/normalizers/control-sources';
import type { BuildContext } from '../../collector/src/normalizers/model';
import {
  toRepositoryControls,
  parseStatusFile,
} from '../../collector/src/normalizers/security-model';
import type { HarborArtifactDTO } from '../../collector/src/providers/external/types';
import { fail, ok, type CodeScanningAnalysisDTO } from '../../collector/src/providers/types';
import { daysAgo, NOW, policies, repoData } from '../helpers/factories';

const ctx: BuildContext = { projectId: 'p', policies: policies(), now: NOW, errors: [] };
const SHA = 'a'.repeat(40);

const cand = (
  source: ControlCandidate['source'],
  state: ControlCandidate['state'],
  extra: Partial<ControlCandidate> = {},
): ControlCandidate => ({
  source,
  state,
  evidence: 'reported',
  tool: null,
  lastScanAt: null,
  counts: null,
  reportUrl: null,
  ...extra,
});

describe('resolveControl: precedence (spec 5.1)', () => {
  const order = ['code-scanning', 'harbor', 'status-file'] as const;

  it('first definitive wins: [code-scanning: not-configured, harbor: enabled, status-file: enabled] → harbor', () => {
    const r = resolveControl(
      'containerScanning',
      true,
      {
        'code-scanning': cand('code-scanning', 'not-configured'),
        harbor: cand('harbor', 'enabled'),
        'status-file': cand('status-file', 'enabled'),
      },
      order,
    );
    expect(r).toMatchObject({ state: 'enabled', source: 'harbor', evidence: 'reported' });
  });

  it('definitive later beats non-definitive earlier: [code-scanning: not-authorised, harbor: off, status-file: enabled] → status-file', () => {
    const r = resolveControl(
      'containerScanning',
      false,
      {
        'code-scanning': cand('code-scanning', 'not-authorised'),
        harbor: cand('harbor', 'off'),
        'status-file': cand('status-file', 'enabled'),
      },
      order,
    );
    expect(r).toMatchObject({ state: 'enabled', source: 'status-file', required: false });
  });

  it('no definitive: [code-scanning: not-authorised, status-file: not-configured] → not-authorised (source code-scanning, no evidence)', () => {
    const r = resolveControl(
      'iacScanning',
      true,
      {
        'code-scanning': cand('code-scanning', 'not-authorised'),
        'status-file': cand('status-file', 'not-configured'),
      },
      ['code-scanning', 'status-file'],
    );
    expect(r).toMatchObject({ state: 'not-authorised', source: 'code-scanning', evidence: null });
  });

  it('the most informative non-answer is the first in the list (unknown before configured-not-run)', () => {
    const r = resolveControl(
      'containerScanning',
      true,
      {
        harbor: cand('harbor', 'configured-not-run'),
        'status-file': cand('status-file', 'unknown'),
      },
      order,
    );
    expect(r).toMatchObject({ state: 'configured-not-run', source: 'harbor' });
  });

  it('every source off or not-configured → not-configured, source null', () => {
    const allOff = resolveControl(
      'sbom',
      true,
      { 'supply-chain-summary': cand('supply-chain-summary', 'off') },
      ['supply-chain-summary', 'dependency-graph', 'status-file'],
    );
    expect(allOff).toMatchObject({
      state: 'not-configured',
      source: null,
      evidence: null,
      counts: null,
      tool: null,
      lastScanAt: null,
    });
    const none = resolveControl('sbom', true, {}, ['supply-chain-summary']);
    expect(none).toMatchObject({ state: 'not-configured', source: null });
    const notConfigured = resolveControl(
      'dast',
      true,
      { 'code-scanning': cand('code-scanning', 'not-configured') },
      ['code-scanning'],
    );
    expect(notConfigured).toMatchObject({ state: 'not-configured', source: null });
  });

  it('stale counts as definitive; failed counts as definitive', () => {
    expect(
      resolveControl(
        'dast',
        true,
        {
          'code-scanning': cand('code-scanning', 'stale', { lastScanAt: daysAgo(10) }),
          'status-file': cand('status-file', 'enabled'),
        },
        ['code-scanning', 'status-file'],
      ),
    ).toMatchObject({ state: 'stale', source: 'code-scanning', evidence: 'reported' });
    expect(
      resolveControl(
        'artifactSignature',
        true,
        {
          'supply-chain-summary': cand('supply-chain-summary', 'failed', { evidence: 'verified' }),
          attestations: cand('attestations', 'enabled', { evidence: 'present' }),
        },
        ['supply-chain-summary', 'attestations'],
      ),
    ).toMatchObject({ state: 'failed', source: 'supply-chain-summary', evidence: 'verified' });
  });

  it('carries the winner tool, date, counts and report url, and never the loser ones', () => {
    const counts = { critical: 0, high: 0, medium: 2, low: 6, informational: 0, unknown: 0 };
    const r = resolveControl(
      'containerScanning',
      true,
      {
        harbor: cand('harbor', 'enabled', {
          tool: 'Harbor',
          lastScanAt: '2026-01-14T12:00:00.000Z',
          counts,
        }),
        'status-file': cand('status-file', 'enabled', { counts: { ...counts, medium: 1, low: 3 } }),
      },
      order,
    );
    expect(r).toMatchObject({ tool: 'Harbor', lastScanAt: '2026-01-14T12:00:00.000Z', counts });
  });
});

describe('matchToolRule', () => {
  it('{ tool: trivy, category: trivy-config } matches Trivy/trivy-config-k8s, not Trivy/trivy-image', () => {
    const rules = [{ tool: 'trivy', category: 'trivy-config' }];
    expect(matchToolRule(rules, 'Trivy', 'trivy-config-k8s')).toBe(true);
    expect(matchToolRule(rules, 'Trivy', 'trivy-image')).toBe(false);
    expect(matchToolRule(rules, 'Trivy', null)).toBe(false);
    expect(matchToolRule(rules, 'Checkov', 'trivy-config')).toBe(false);
    expect(matchToolRule(rules, null, 'trivy-config')).toBe(false);
  });
  it('a rule without category matches any category, case-insensitively', () => {
    expect(matchToolRule([{ tool: 'ZAP' }], 'zap', null)).toBe(true);
    expect(matchToolRule([{ tool: 'ZAP' }], 'ZAP', 'anything')).toBe(true);
    expect(matchToolRule([], 'ZAP', null)).toBe(false);
  });
});

describe('toolCandidate (code-scanning source)', () => {
  const rules = [{ tool: 'Trivy' }];
  const analyses = (
    r: ReturnType<typeof ok<CodeScanningAnalysisDTO[]>> | ReturnType<typeof fail>,
  ) => new Map([['trivy', r as never]]);
  const analysis = (createdAt: string, category = 'trivy-image'): CodeScanningAnalysisDTO => ({
    createdAt,
    toolName: 'Trivy',
    category,
  });

  it('Trivy analysis @now-2d → enabled; @now-9d → stale (securityScanStaleDays 7)', () => {
    const fresh = toolCandidate(ctx, rules, analyses(ok([analysis(daysAgo(2))])), []);
    expect(fresh).toMatchObject({
      source: 'code-scanning',
      state: 'enabled',
      evidence: 'reported',
      tool: 'Trivy',
      lastScanAt: daysAgo(2),
    });
    const old = toolCandidate(ctx, rules, analyses(ok([analysis(daysAgo(9))])), []);
    expect(old.state).toBe('stale');
  });

  it('none → not-configured; 403 → not-authorised; other error → unknown', () => {
    expect(toolCandidate(ctx, rules, analyses(ok([])), []).state).toBe('not-configured');
    expect(
      toolCandidate(ctx, rules, analyses(fail({ classification: 'not-authorised' })), []).state,
    ).toBe('not-authorised');
    expect(toolCandidate(ctx, rules, analyses(fail({ classification: 'error' })), []).state).toBe(
      'unknown',
    );
  });

  it('no rules, or analyses not collected → off', () => {
    expect(toolCandidate(ctx, [], new Map(), []).state).toBe('off');
    expect(toolCandidate(ctx, rules, null, []).state).toBe('off');
    expect(toolCandidate(ctx, rules, new Map(), []).state).toBe('off');
  });

  it('counts the open alerts of the tool by severity; an unreadable alert list gives null counts', () => {
    const alert = (n: number, tool: string, severity: string, state = 'open') => ({
      number: n,
      state,
      dismissedReason: null,
      ruleId: 'r',
      ruleSeverity: 'warning',
      securitySeverityLevel: severity,
      ruleDescription: null,
      toolName: tool,
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
      htmlUrl: 'https://github.com/o/r/security/code-scanning/1',
      category: 'trivy-image',
    });
    const c = toolCandidate(ctx, rules, analyses(ok([analysis(daysAgo(1))])), [
      alert(1, 'Trivy', 'low'),
      alert(2, 'Trivy', 'low', 'fixed'),
      alert(3, 'CodeQL', 'critical'),
    ]);
    expect(c.counts).toMatchObject({ critical: 0, low: 1 });
    expect(toolCandidate(ctx, rules, analyses(ok([analysis(daysAgo(1))])), null).counts).toBeNull();
  });

  it('a category rule only looks at analyses of that category', () => {
    const iac = [{ tool: 'Trivy', category: 'trivy-config' }];
    expect(
      toolCandidate(ctx, iac, analyses(ok([analysis(daysAgo(1), 'trivy-image')])), []).state,
    ).toBe('not-configured');
    expect(
      toolCandidate(ctx, iac, analyses(ok([analysis(daysAgo(1), 'trivy-config-k8s')])), []).state,
    ).toBe('enabled');
  });
});

describe('harborContainerCandidate', () => {
  const dto = (
    status: NonNullable<HarborArtifactDTO['scan']>['status'],
    endTime: string | null,
    over: Partial<NonNullable<HarborArtifactDTO['scan']>> = {},
    sig = { cosign: false, notation: false },
  ): HarborArtifactDTO => ({
    digest: null,
    scan: {
      status,
      endTime,
      critical: 0,
      high: 0,
      medium: 2,
      low: 6,
      unknown: 0,
      fixable: 3,
      total: 8,
      ...over,
    },
    signatures: sig,
  });
  const img = (
    result: HarborImageResult['result'],
    componentId = 'backend',
  ): HarborImageResult => ({
    componentId,
    project: 'alpha',
    repository: 'backend',
    reference: '1.4.0',
    result,
  });

  it('all scanned → enabled with the summed counts, Harbor as tool', () => {
    const c = harborContainerCandidate(ctx, [
      img(ok(dto('success', daysAgo(1)))),
      img(ok(dto('success', daysAgo(2))), 'web'),
    ]);
    expect(c).toMatchObject({
      source: 'harbor',
      state: 'enabled',
      evidence: 'reported',
      tool: 'Harbor',
      counts: { critical: 0, high: 0, medium: 4, low: 12, informational: 0, unknown: 0 },
    });
  });

  it('one Error → failed; Running → configured-not-run; scannedAt older than 7 days → stale', () => {
    expect(
      harborContainerCandidate(ctx, [
        img(ok(dto('success', daysAgo(1)))),
        img(ok(dto('error', null, { critical: null }))),
      ]).state,
    ).toBe('failed');
    expect(
      harborContainerCandidate(ctx, [img(ok(dto('running', null, { medium: null, low: null })))]),
    ).toMatchObject({ state: 'configured-not-run', counts: null });
    expect(
      harborContainerCandidate(ctx, [
        img(ok(dto('pending', null))),
        img(ok(dto('not-scanned', null))),
      ]).state,
    ).toBe('configured-not-run');
    expect(harborContainerCandidate(ctx, [img(ok(dto('success', daysAgo(9))))])).toMatchObject({
      state: 'stale',
      lastScanAt: daysAgo(9),
    });
  });

  it('401/403 → not-authorised; tag 404 → unknown; error → collection-failed; no version → unknown', () => {
    const f = (classification: 'not-authorised' | 'not-found' | 'error' | 'rate-limited') =>
      harborContainerCandidate(ctx, [img(fail({ classification }))]).state;
    expect(f('not-authorised')).toBe('not-authorised');
    expect(f('not-found')).toBe('unknown');
    expect(f('error')).toBe('collection-failed');
    expect(f('rate-limited')).toBe('collection-failed');
    expect(harborContainerCandidate(ctx, [img(null)]).state).toBe('unknown');
  });

  it('no mapped image → off; a scanned image does not hide an image that cannot be read', () => {
    expect(harborContainerCandidate(ctx, []).state).toBe('off');
    const c = harborContainerCandidate(ctx, [
      img(ok(dto('success', daysAgo(1)))),
      img(fail({ classification: 'not-found' })),
    ]);
    expect(c).toMatchObject({ state: 'unknown', counts: null });
  });
});

describe('sbomCandidates', () => {
  const summaryOf = (over: Partial<SupplyChainSummary> = {}): SupplyChainSummary => ({
    schemaVersion: '1.0',
    repository: 'o/r',
    ref: 'refs/heads/main',
    commitSha: SHA,
    generatedAt: daysAgo(1),
    sbom: {
      format: 'cyclonedx',
      specVersion: '1.6',
      tool: 'syft',
      packages: 812,
      withoutLicense: 9,
      licenses: [{ id: 'MIT', count: 812 }],
      ecosystems: [{ id: 'npm', count: 812 }],
    },
    ...over,
  });
  const summary = (
    state: ParsedSupplyChainSummary['state'],
    s: SupplyChainSummary | null = null,
  ): ParsedSupplyChainSummary => ({
    state,
    summary: s,
    generatedAt: s?.generatedAt ?? null,
    commitSha: s?.commitSha ?? null,
    runUrl: null,
  });
  const dg = (r: SbomResult) => r;

  it('summary readable with an sbom block → enabled; without it → not-configured', () => {
    const a = sbomCandidates(ctx, summary('readable', summaryOf()), dg({ state: 'off' }));
    expect(a['supply-chain-summary']).toMatchObject({
      state: 'enabled',
      evidence: 'reported',
      tool: 'syft',
      counts: null,
      lastScanAt: summaryOf().generatedAt,
    });
    const b = sbomCandidates(
      ctx,
      summary('readable', summaryOf({ sbom: undefined })),
      dg({ state: 'off' }),
    );
    expect(b['supply-chain-summary'].state).toBe('not-configured');
  });

  it('summary states: stale → stale; missing → not-configured; not-authorised; expired/invalid/unknown → unknown; off → off', () => {
    const st = (s: ParsedSupplyChainSummary) =>
      sbomCandidates(ctx, s, dg({ state: 'off' }))['supply-chain-summary'].state;
    expect(st(summary('stale', summaryOf()))).toBe('stale');
    expect(st(summary('missing'))).toBe('not-configured');
    expect(st(summary('not-authorised'))).toBe('not-authorised');
    for (const s of ['expired', 'invalid', 'unknown'] as const)
      expect(st(summary(s))).toBe('unknown');
    expect(st(summary('off'))).toBe('off');
  });

  it('dependency graph: available or partial → enabled (present); not-configured, not-authorised; pending, too-large, invalid, unknown → unknown; off → off', () => {
    const state = (r: SbomResult) =>
      sbomCandidates(ctx, summary('off'), r)['dependency-graph'].state;
    const sbomSummary = {
      format: 'spdx' as const,
      specVersion: '2.3',
      generatedAt: daysAgo(0),
      packages: 214,
      withoutLicense: 6,
      flagged: 0,
      licenses: [],
      otherLicenses: 0,
      ecosystems: [],
      partial: false,
    };
    const avail = sbomCandidates(ctx, summary('off'), { state: 'available', summary: sbomSummary });
    expect(avail['dependency-graph']).toMatchObject({ state: 'enabled', evidence: 'present' });
    expect(state({ state: 'partial', summary: { ...sbomSummary, partial: true } })).toBe('enabled');
    expect(state({ state: 'not-configured' })).toBe('not-configured');
    expect(state({ state: 'not-authorised' })).toBe('not-authorised');
    for (const s of ['pending', 'too-large', 'invalid', 'unknown'] as const)
      expect(state({ state: s })).toBe('unknown');
    expect(state({ state: 'off' })).toBe('off');
  });
});

describe('signatureCandidates', () => {
  const image = (
    signature?: { status: 'verified' | 'not-verified' | 'failed' | 'missing' },
    name = 'example-org/app',
  ) => ({ name, digest: `sha256:${'b'.repeat(64)}`, ...(signature ? { signature } : {}) });
  const summary = (images: ReturnType<typeof image>[]): ParsedSupplyChainSummary => {
    const s = {
      schemaVersion: '1.0',
      repository: 'o/r',
      ref: 'refs/heads/main',
      commitSha: SHA,
      generatedAt: daysAgo(1),
      images,
    } as SupplyChainSummary;
    return {
      state: 'readable',
      summary: s,
      generatedAt: s.generatedAt,
      commitSha: SHA,
      runUrl: null,
    };
  };
  const att = (over: Partial<AttestationResult>): AttestationResult => ({
    state: 'available',
    release: 'v1.0.0',
    checked: 2,
    withProvenance: 2,
    withSbom: 0,
    withoutDigest: 0,
    ...over,
  });
  const off = (): AttestationResult => ({
    state: 'off',
    release: null,
    checked: 0,
    withProvenance: null,
    withSbom: null,
    withoutDigest: 0,
  });
  const run = (s: ParsedSupplyChainSummary, a: AttestationResult, h: HarborImageResult[] = []) =>
    signatureCandidates(ctx, s, a, h);
  const none: ParsedSupplyChainSummary = {
    state: 'off',
    summary: null,
    generatedAt: null,
    commitSha: null,
    runUrl: null,
  };

  it('summary: all verified → enabled/verified; not-verified or failed → failed; missing → not-configured; no images → not-configured', () => {
    expect(
      run(summary([image({ status: 'verified' }), image({ status: 'verified' })]), off())[
        'supply-chain-summary'
      ],
    ).toMatchObject({ state: 'enabled', evidence: 'verified' });
    expect(
      run(summary([image({ status: 'verified' }), image({ status: 'not-verified' })]), off())[
        'supply-chain-summary'
      ].state,
    ).toBe('failed');
    expect(run(summary([image({ status: 'failed' })]), off())['supply-chain-summary'].state).toBe(
      'failed',
    );
    expect(run(summary([image({ status: 'missing' })]), off())['supply-chain-summary'].state).toBe(
      'not-configured',
    );
    expect(run(summary([]), off())['supply-chain-summary'].state).toBe('not-configured');
    expect(run(summary([image()]), off())['supply-chain-summary'].state).toBe('unknown');
  });

  it('attestations: 1 of 2 with provenance → failed; 2 of 2 → enabled/present; none → not-configured', () => {
    expect(run(none, att({ withProvenance: 1 })).attestations.state).toBe('failed');
    expect(run(none, att({ withProvenance: 2 })).attestations).toMatchObject({
      state: 'enabled',
      evidence: 'present',
    });
    expect(run(none, att({ state: 'none', withProvenance: 0 })).attestations.state).toBe(
      'not-configured',
    );
  });

  it('attestations: assets without any digest → unknown; not-authorised; unknown; off or not-applicable → off', () => {
    expect(
      run(none, att({ checked: 0, withProvenance: 0, withoutDigest: 1, state: 'none' }))
        .attestations.state,
    ).toBe('unknown');
    expect(
      run(none, att({ state: 'not-authorised', withProvenance: null })).attestations.state,
    ).toBe('not-authorised');
    expect(run(none, att({ state: 'unknown', withProvenance: null })).attestations.state).toBe(
      'unknown',
    );
    expect(run(none, off()).attestations.state).toBe('off');
    expect(run(none, att({ state: 'not-applicable', checked: 0 })).attestations.state).toBe('off');
  });

  it('harbor: cosign on every image → enabled/present; none → not-configured; some → failed', () => {
    const h = (cosign: boolean, notation = false): HarborImageResult => ({
      componentId: 'backend',
      project: 'alpha',
      repository: 'backend',
      reference: '1.4.0',
      result: ok({ digest: null, scan: null, signatures: { cosign, notation } }),
    });
    expect(run(none, off(), [h(true), h(false, true)]).harbor).toMatchObject({
      state: 'enabled',
      evidence: 'present',
    });
    expect(run(none, off(), [h(false)]).harbor.state).toBe('not-configured');
    expect(run(none, off(), [h(true), h(false)]).harbor.state).toBe('failed');
    expect(run(none, off(), []).harbor.state).toBe('off');
    const err = (classification: 'not-authorised' | 'not-found'): HarborImageResult => ({
      ...h(true),
      result: fail({ classification }),
    });
    expect(run(none, off(), [err('not-authorised')]).harbor.state).toBe('not-authorised');
    expect(run(none, off(), [err('not-found')]).harbor.state).toBe('unknown');
  });
});

describe('toRepositoryControls with sources', () => {
  const project = (notApplicable: string[] = []) =>
    ({
      securityControls: Object.fromEntries(
        [
          'codeScanning',
          'secretScanning',
          'dependabot',
          'containerScanning',
          'iacScanning',
          'dast',
          'sbom',
          'artifactSignature',
        ].map((c) => [c, { required: true }]),
      ),
      coordinator: { notApplicableControls: notApplicable },
      components: [],
    }) as unknown as ProjectConfig;
  const data = repoData('app');
  const statusFile = parseStatusFile(ctx, data); // missing

  it('without any supply-chain evidence the non-native controls stay not-configured with no source (v0.9.0 behaviour)', () => {
    const rc = toRepositoryControls(ctx, project(), data, [], statusFile, NO_SUPPLY_EVIDENCE);
    for (const c of rc.controls.filter((x) =>
      ['containerScanning', 'iacScanning', 'dast', 'sbom', 'artifactSignature'].includes(x.control),
    ))
      expect(c).toMatchObject({ state: 'not-configured', source: null, evidence: null });
    for (const c of rc.controls.filter((x) => ['codeScanning', 'dependabot'].includes(x.control)))
      expect(c).toMatchObject({ source: 'github', evidence: 'reported' });
  });

  it('notApplicableControls wins over every source', () => {
    const rc = toRepositoryControls(
      ctx,
      project(['containerScanning']),
      repoData('app', { componentId: 'coordinator' }),
      [],
      statusFile,
      {
        ...NO_SUPPLY_EVIDENCE,
        analyses: new Map([
          ['trivy', ok([{ createdAt: daysAgo(1), toolName: 'Trivy', category: 'trivy-image' }])],
        ]),
      },
    );
    expect(rc.controls.find((c) => c.control === 'containerScanning')).toMatchObject({
      state: 'not-applicable',
      required: false,
      source: null,
      evidence: null,
    });
  });

  it('a Trivy analysis makes containerScanning enabled via code-scanning', () => {
    const rc = toRepositoryControls(ctx, project(), data, [], statusFile, {
      ...NO_SUPPLY_EVIDENCE,
      analyses: new Map([
        ['trivy', ok([{ createdAt: daysAgo(1), toolName: 'Trivy', category: 'trivy-image' }])],
      ]),
    });
    expect(rc.controls.find((c) => c.control === 'containerScanning')).toMatchObject({
      state: 'enabled',
      source: 'code-scanning',
      evidence: 'reported',
      tool: 'Trivy',
    });
  });

  it('with supplyChain.enabled false the evidence is ignored', () => {
    const off = { ...ctx, policies: policies((p) => (p.supplyChain.enabled = false)) };
    const rc = toRepositoryControls(off, project(), data, [], statusFile, {
      ...NO_SUPPLY_EVIDENCE,
      analyses: new Map([
        ['trivy', ok([{ createdAt: daysAgo(1), toolName: 'Trivy', category: 'trivy-image' }])],
      ]),
    });
    expect(rc.controls.find((c) => c.control === 'containerScanning')).toMatchObject({
      state: 'not-configured',
      source: null,
    });
  });
});
