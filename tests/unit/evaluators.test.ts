import { describe, expect, it } from 'vitest';
import type {
  ComponentSnapshot,
  CoverageSummary,
  RepositoryControls,
  SecurityFinding,
} from '@model/index';
import {
  evaluateCoverage,
  evaluateDelivery,
  evaluateGovernance,
  evaluateOverall,
  evaluateSecurity,
  evaluateVersion,
  type SecurityInputs,
} from '../../collector/src/evaluators/health';
import { emptyCounts } from '../../collector/src/normalizers/security-model';
import { hoursAgo, NOW, policies, workflow } from '../helpers/factories';

const P = policies();
const run = (createdAt: string, extra: object = {}) => ({
  id: 1,
  runNumber: 7,
  runAttempt: 1,
  status: 'completed',
  conclusion: 'success',
  branch: 'main',
  event: 'push',
  sha: null,
  createdAt,
  updatedAt: createdAt,
  url: null,
  ...extra,
});

describe('delivery health', () => {
  it('green when every critical workflow last succeeded', () => {
    expect(evaluateDelivery([workflow(), workflow({ workflowId: 'rel' })], P, NOW).status).toBe(
      'green',
    );
  });
  it('red when a critical workflow failed or was cancelled', () => {
    expect(evaluateDelivery([workflow(), workflow({ state: 'failure' })], P, NOW).status).toBe(
      'red',
    );
    expect(evaluateDelivery([workflow({ state: 'cancelled' })], P, NOW).status).toBe('red');
  });
  it('amber when a critical workflow is missing, never run, stale or queued too long', () => {
    expect(evaluateDelivery([workflow({ state: 'missing' })], P, NOW).status).toBe('amber');
    expect(evaluateDelivery([workflow({ state: 'never-run' })], P, NOW).status).toBe('amber');
    expect(evaluateDelivery([workflow({ stale: true })], P, NOW).status).toBe('amber');
    const queued = evaluateDelivery(
      [workflow({ state: 'queued', activeRun: run(hoursAgo(3), { status: 'queued' }) })],
      P,
      NOW,
    );
    expect(queued.status).toBe('amber');
    expect(queued.reasons.map((r) => r.code)).toContain('workflow-queued-too-long');
  });
  it('amber (not green) when only part of the data is available', () => {
    expect(
      evaluateDelivery([workflow(), workflow({ state: 'not-authorised' })], P, NOW).status,
    ).toBe('amber');
  });
  it('grey when no critical workflow data is available or none is configured', () => {
    expect(
      evaluateDelivery(
        [workflow({ state: 'not-authorised' }), workflow({ state: 'unknown' })],
        P,
        NOW,
      ).status,
    ).toBe('grey');
    expect(evaluateDelivery([workflow({ critical: false })], P, NOW).status).toBe('grey');
  });
  it('ignores non-critical failures for the status but reports them', () => {
    const r = evaluateDelivery(
      [workflow(), workflow({ critical: false, state: 'failure' })],
      P,
      NOW,
    );
    expect(r.status).toBe('green');
    expect(r.reasons.map((x) => x.code)).toContain('non-critical-workflow-failed');
  });
});

const controls = (states: Record<string, string>, required: string[]): RepositoryControls[] => [
  {
    componentId: 'backend',
    repository: 'example-org/backend',
    controls: Object.entries(states).map(([control, state]) => ({
      control: control as never,
      required: required.includes(control),
      state: state as never,
      tool: null,
      lastScanAt: null,
      counts: null,
      reportUrl: null,
    })),
  },
];
const ALL = ['codeScanning', 'secretScanning', 'dependabot', 'containerScanning'] as never[];

describe('security coverage', () => {
  it('computes the percentage on required controls only', () => {
    const c = evaluateCoverage(
      ['codeScanning', 'secretScanning', 'dependabot', 'containerScanning'],
      ALL,
      controls(
        {
          codeScanning: 'enabled',
          secretScanning: 'enabled',
          dependabot: 'enabled',
          containerScanning: 'not-configured',
        },
        ['codeScanning', 'secretScanning', 'dependabot', 'containerScanning'],
      ),
      P,
      NOW.toISOString(),
    );
    expect(c).toMatchObject({
      percentage: 75,
      required: 4,
      available: 3,
      notConfigured: 1,
      unknown: 0,
      status: 'amber',
    });
  });
  it('is green only with every required control available', () => {
    const c = evaluateCoverage(
      ['codeScanning'],
      ALL,
      controls({ codeScanning: 'enabled', dast: 'not-configured' }, ['codeScanning']),
      P,
      NOW.toISOString(),
    );
    expect(c).toMatchObject({ percentage: 100, status: 'green' });
  });
  it('is grey with no percentage when nothing required could be read', () => {
    const c = evaluateCoverage(
      ['codeScanning', 'dependabot'],
      ALL,
      controls({ codeScanning: 'not-authorised', dependabot: 'unknown' }, [
        'codeScanning',
        'dependabot',
      ]),
      P,
      NOW.toISOString(),
    );
    expect(c).toMatchObject({ percentage: null, status: 'grey', notAuthorised: 1, unknown: 1 });
  });
  it('uses the worst state across repositories', () => {
    const repos = [
      ...controls({ codeScanning: 'enabled' }, ['codeScanning']),
      ...controls({ codeScanning: 'stale' }, ['codeScanning']),
    ];
    expect(evaluateCoverage(['codeScanning'], ALL, repos, P, NOW.toISOString())).toMatchObject({
      stale: 1,
      available: 0,
    });
  });
});

const coverage = (partial: Partial<CoverageSummary> = {}): CoverageSummary => ({
  status: 'green',
  reasons: [],
  percentage: 100,
  required: 3,
  available: 3,
  notConfigured: 0,
  notAuthorised: 0,
  unknown: 0,
  failed: 0,
  stale: 0,
  collectedAt: NOW.toISOString(),
  perControl: [],
  ...partial,
});
const inputs = (partial: Partial<SecurityInputs> = {}): SecurityInputs => ({
  findings: [] as SecurityFinding[],
  repos: [],
  coverage: coverage(),
  externalCounts: emptyCounts(null),
  anySourceReadable: true,
  countsComplete: true,
  secretSourceReadable: true,
  detailsWithheld: false,
  ...partial,
});
const counts = (c: Partial<Record<'critical' | 'high' | 'medium' | 'low', number>>) => ({
  ...emptyCounts(0),
  ...c,
});

describe('security risk', () => {
  it('red with an open critical alert', () => {
    expect(evaluateSecurity(inputs(), counts({ critical: 1 }), 0, P).status).toBe('red');
  });
  it('red with an open secret scanning alert', () => {
    expect(evaluateSecurity(inputs(), counts({}), 1, P).status).toBe('red');
  });
  it('red when a required control reports failure', () => {
    const cov = coverage({
      status: 'amber',
      perControl: [{ control: 'containerScanning', required: true, state: 'failed' }],
    });
    expect(evaluateSecurity(inputs({ coverage: cov }), counts({}), 0, P).status).toBe('red');
  });
  it('amber with high alerts, or with only medium/low alerts', () => {
    expect(evaluateSecurity(inputs(), counts({ high: 2 }), 0, P).status).toBe('amber');
    expect(evaluateSecurity(inputs(), counts({ medium: 1, low: 4 }), 0, P).status).toBe('amber');
  });
  it('amber when coverage is incomplete or a scan is stale, even with zero alerts', () => {
    expect(
      evaluateSecurity(
        inputs({ coverage: coverage({ status: 'amber', percentage: 75 }) }),
        counts({}),
        0,
        P,
      ).status,
    ).toBe('amber');
    const stale = coverage({
      status: 'amber',
      perControl: [{ control: 'codeScanning', required: true, state: 'stale' }],
    });
    expect(
      evaluateSecurity(inputs({ coverage: stale }), counts({}), 0, P).reasons.map((r) => r.code),
    ).toContain('required-control-stale');
  });
  it('green only with zero alerts, full coverage and complete data', () => {
    const r = evaluateSecurity(inputs(), counts({}), 0, P);
    expect(r.status).toBe('green');
    expect(r.reasons.map((x) => x.code)).toEqual(['no-open-alerts']);
    expect(evaluateSecurity(inputs({ countsComplete: false }), counts({}), 0, P).status).toBe(
      'amber',
    );
  });
  it('grey when no alert source was readable (zero is not assumed)', () => {
    expect(
      evaluateSecurity(inputs({ anySourceReadable: false }), emptyCounts(null), null, P).status,
    ).toBe('grey');
  });
  it('still red when a known critical exists despite missing data', () => {
    expect(
      evaluateSecurity(inputs({ anySourceReadable: false }), counts({ critical: 1 }), null, P)
        .status,
    ).toBe('red');
  });
  it('follows the configured thresholds', () => {
    const strict = policies((p) => {
      p.security.redOnSeverities = ['critical', 'high'];
    });
    expect(evaluateSecurity(inputs(), counts({ high: 1 }), 0, strict).status).toBe('red');
  });
});

describe('version health', () => {
  const component = (
    drift: 'aligned' | 'drift' | 'unknown',
    extra: Partial<ComponentSnapshot> = {},
  ): ComponentSnapshot => ({
    id: 'fe',
    name: 'Frontend',
    type: 'webapp' as const,
    repository: {} as never,
    declaredVersion: '2.1.0',
    latestRelease: {
      tag: 'v2.2.0',
      name: null,
      publishedAt: null,
      prerelease: false,
      url: null,
      kind: 'release' as const,
    },
    submodule: null,
    versionSource: 'auto',
    pin: null,
    effectiveVersion: '2.1.0',
    effectiveVersionSource: 'manifest',
    manifestConsistency: 'unknown',
    drift,
    ...extra,
  });
  const pin = (
    status: 'tagged' | 'ahead' | 'behind' | 'diverged',
    version: string | null = null,
  ) => ({
    status,
    tag: version ? `v${version}` : null,
    version,
    comparedTo: status === 'tagged' ? null : 'v2.2.0',
    aheadBy: status === 'ahead' ? 3 : null,
    behindBy: status === 'ahead' ? 0 : null,
  });
  it('amber when the coordinator pins an untagged SHA (ahead/behind/diverged)', () => {
    const r = evaluateVersion(
      { ...base, components: [component('aligned', { pin: pin('ahead') })] },
      P,
    );
    expect(r.status).toBe('amber');
    expect(r.reasons.map((x) => x.code)).toContain('submodule-untagged');
  });
  it('flags a manifest declaration that differs from the pinned version', () => {
    const c = component('aligned', {
      pin: pin('tagged', '2.0.0'),
      manifestConsistency: 'mismatch',
    });
    const r = evaluateVersion({ ...base, components: [c] }, P);
    expect(r.reasons.find((x) => x.code === 'manifest-submodule-mismatch')?.params).toMatchObject({
      declared: '2.1.0',
      pinned: '2.0.0',
    });
    const strict = policies((p) => {
      p.version.manifestSubmoduleMismatch = 'red';
    });
    expect(evaluateVersion({ ...base, components: [c] }, strict).status).toBe('red');
  });
  const base = {
    coordinatorVersion: '1.4.0',
    manifestState: 'ok' as const,
    unknownManifestComponents: [],
    submodules: [],
    environments: [],
  };
  it('green when aligned', () =>
    expect(evaluateVersion({ ...base, components: [component('aligned')] }, P).status).toBe(
      'green',
    ));
  it('amber on drift or environment behind', () => {
    expect(evaluateVersion({ ...base, components: [component('drift')] }, P).status).toBe('amber');
    const env = {
      id: 'prod',
      name: 'PROD',
      version: '1.3.0',
      source: 'manifest' as const,
      status: 'behind' as const,
    };
    expect(
      evaluateVersion({ ...base, components: [component('aligned')], environments: [env] }, P)
        .status,
    ).toBe('amber');
  });
  it('red when the manifest references an unknown component or a submodule cannot be resolved', () => {
    expect(
      evaluateVersion(
        { ...base, components: [component('aligned')], unknownManifestComponents: ['ghost'] },
        P,
      ).status,
    ).toBe('red');
    const sub = {
      path: 'x',
      repository: null,
      sha: null,
      componentId: 'fe',
      association: 'configured-path' as const,
      status: 'unresolvable' as const,
    };
    expect(
      evaluateVersion({ ...base, components: [component('aligned')], submodules: [sub] }, P).status,
    ).toBe('red');
  });
  it('grey when no version can be determined', () => {
    const c = { ...component('unknown'), declaredVersion: null, latestRelease: null };
    expect(evaluateVersion({ ...base, coordinatorVersion: null, components: [c] }, P).status).toBe(
      'grey',
    );
  });
});

describe('governance health', () => {
  const repo = (partial = {}) => ({
    componentId: 'backend',
    statusFile: 'ok' as const,
    needsStatusFile: true,
    repository: {
      fullName: 'example-org/b',
      owner: 'example-org',
      name: 'b',
      url: null,
      status: 'ok' as const,
      visibility: 'public' as const,
      defaultBranch: 'main',
      configuredDefaultBranch: 'main',
      archived: false,
      updatedAt: null,
      topics: [],
      latestCommit: null,
      ...partial,
    },
  });
  it('green when compliant', () =>
    expect(evaluateGovernance([repo()], [workflow()], P).status).toBe('green'));
  it('amber for missing standard workflows, archived repos and branch mismatch', () => {
    expect(evaluateGovernance([repo()], [workflow({ state: 'missing' })], P).status).toBe('amber');
    expect(evaluateGovernance([repo({ archived: true })], [], P).status).toBe('amber');
    expect(evaluateGovernance([repo({ defaultBranch: 'master' })], [], P).reasons[0]!.code).toBe(
      'default-branch-mismatch',
    );
  });
  it('grey when no repository is accessible', () => {
    expect(evaluateGovernance([repo({ status: 'not-authorised' })], [], P).status).toBe('grey');
  });
});

describe('overall health', () => {
  const dims = (d = {}) =>
    ({
      delivery: 'green',
      version: 'green',
      security: 'green',
      coverage: 'green',
      governance: 'green',
      ...d,
    }) as never;
  it('red if a critical dimension is red', () =>
    expect(evaluateOverall(dims({ security: 'red' }), P).status).toBe('red'));
  it('amber if a non-critical dimension is red', () =>
    expect(evaluateOverall(dims({ governance: 'red' }), P).status).toBe('amber'));
  it('amber if any dimension is amber', () =>
    expect(evaluateOverall(dims({ coverage: 'amber' }), P).status).toBe('amber'));
  it('green only if all required dimensions are green', () =>
    expect(evaluateOverall(dims(), P).status).toBe('green'));
  it('grey when a required dimension is undeterminable', () =>
    expect(evaluateOverall(dims({ version: 'grey' }), P).status).toBe('grey'));
  it('lists every contributing dimension', () => {
    const r = evaluateOverall(dims({ delivery: 'red', coverage: 'amber' }), P);
    expect(r.reasons.map((x) => `${x.code}:${x.params.dimension}`)).toEqual([
      'dimension-red:delivery',
      'dimension-amber:coverage',
    ]);
  });
});
