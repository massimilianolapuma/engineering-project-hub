import { describe, expect, it } from 'vitest';
import { QualityHealthSchema, type Policies } from '@model/index';
import {
  isCoverageApplicable,
  normaliseQualitySummary,
  type RepoQuality,
  type RepoQualityState,
} from '../../collector/src/normalizers/quality';
import {
  evaluateQuality,
  selectReport,
  type QualityInput,
} from '../../collector/src/evaluators/quality';
import { normaliseSonarProject, type SonarQuality } from '../../collector/src/normalizers/quality';
import type { SonarProjectDTO } from '../../collector/src/providers/external/types';
import {
  fail,
  ok,
  type CodeQualityFindingDTO,
  type ProviderResult,
  type QualitySummaryArtifactDTO,
} from '../../collector/src/providers/types';
import { CANARIES } from '../helpers/canaries';
import { daysAgo, NOW, policies } from '../helpers/factories';

const P = policies();
const SHA = 'c'.repeat(40);

function summary(repository: string, covered: number, valid: number, extra: object = {}) {
  return {
    schemaVersion: '1.0',
    repository,
    ref: 'refs/heads/main',
    commitSha: SHA,
    generatedAt: daysAgo(1),
    tool: 'coverlet',
    format: 'cobertura',
    lines: { covered, valid },
    ...extra,
  };
}

function artifact(text: string | null): ProviderResult<QualitySummaryArtifactDTO> {
  return ok({
    summaryText: text,
    createdAt: daysAgo(1),
    runUrl: 'https://github.com/example-org/repo/actions/runs/42',
  });
}

/** A repository report as normalised by normaliseQualitySummary. */
function repo(
  repository: string,
  state: RepoQualityState,
  covered: number | null = null,
  valid: number | null = null,
  generatedAt: string | null = daysAgo(1),
): RepoQuality {
  const visible = state === 'readable' || state === 'stale';
  return {
    repository,
    state,
    linesCovered: visible ? covered : null,
    linesValid: visible ? valid : null,
    commitSha: visible ? SHA : null,
    generatedAt: visible ? generatedAt : null,
    tool: visible ? 'coverlet' : null,
    runUrl: visible ? `https://github.com/${repository}/actions/runs/1` : null,
  };
}

function input(
  components: QualityInput['components'],
  repos: RepoQuality[],
  extra: Partial<QualityInput> = {},
): QualityInput {
  return {
    components,
    ciReports: new Map(repos.map((r) => [r.repository.toLowerCase(), r])),
    findings: new Map(),
    collectedAt: NOW.toISOString(),
    ...extra,
  };
}

const evaluate = (i: QualityInput, p: Policies = P) => {
  const q = evaluateQuality(i, p);
  // Every result is publishable as is.
  QualityHealthSchema.parse(q);
  return q;
};
const codes = (q: { reasons: { code: string }[] }) => q.reasons.map((r) => r.code);
const reasonOf = (q: { reasons: { code: string }[] }, code: string) =>
  q.reasons.find((r) => r.code === code) as
    { code: string; level: string; params: Record<string, string | number> } | undefined;

const BETA = 'example-org/project-beta';
const BETA_API = 'example-org/project-beta-api';
const BETA_WEB = 'example-org/project-beta-web';
const BETA_HELM = 'example-org/project-beta-helm';

describe('evaluateQuality', () => {
  it('beta-like project: coordinator 456/1200 + api 5998/8400 + web missing + helm not applicable → 67.2, amber', () => {
    const q = evaluate(
      input(
        [
          { componentId: 'coordinator', repository: BETA, applicable: true },
          { componentId: 'api', repository: BETA_API, applicable: true },
          { componentId: 'web', repository: BETA_WEB, applicable: true },
          { componentId: 'helm', repository: BETA_HELM, applicable: false },
        ],
        [
          repo(BETA, 'readable', 456, 1200),
          repo(BETA_API, 'readable', 5998, 8400),
          repo(BETA_WEB, 'missing'),
        ],
      ),
    );
    expect(q.percentage).toBe(67.2);
    expect(q.linesCovered).toBe(6454);
    expect(q.linesValid).toBe(9600);
    expect(q).toMatchObject({ applicable: 3, measured: 2, notVisible: 1, stale: 0 });
    expect(q.status).toBe('amber');
    expect(codes(q)).toContain('quality-below-threshold');
    expect(reasonOf(q, 'quality-below-threshold')!.level).toBe('amber');
    expect(reasonOf(q, 'quality-report-missing')).toMatchObject({
      level: 'amber',
      params: { components: 'web' },
    });
    expect(q.perComponent.map((c) => [c.componentId, c.state])).toEqual([
      ['coordinator', 'readable'],
      ['api', 'readable'],
      ['web', 'missing'],
      ['helm', 'not-applicable'],
    ]);
    expect(q.perComponent[0]!.percentage).toBe(38);
    expect(q.perComponent[2]!.percentage).toBeNull();
    expect(q.perComponent.every((c) => !c.sharedRepository)).toBe(true);
  });

  it('alpha-like project: 14400/17000 → 84.7, green, quality-all-above-threshold', () => {
    const q = evaluate(
      input(
        [
          { componentId: 'coordinator', repository: 'example-org/alpha', applicable: true },
          { componentId: 'backend', repository: 'example-org/alpha-backend', applicable: true },
        ],
        [
          repo('example-org/alpha', 'readable', 2400, 3000),
          repo('example-org/alpha-backend', 'readable', 12000, 14000),
        ],
      ),
    );
    expect(q.percentage).toBe(84.7);
    expect(q.status).toBe('green');
    expect(codes(q)).toEqual(['quality-all-above-threshold']);
    expect(reasonOf(q, 'quality-all-above-threshold')!.level).toBe('info');
  });

  it('monorepo: coordinator, web, api, worker on one repo 2900/5000 → 58, lines counted once', () => {
    const MONO = 'example-org/mono';
    const q = evaluate(
      input(
        ['coordinator', 'web', 'api', 'worker'].map((componentId) => ({
          componentId,
          repository: componentId === 'api' ? 'Example-Org/Mono' : MONO,
          applicable: true,
        })),
        [repo(MONO, 'readable', 2900, 5000)],
      ),
    );
    expect(q.percentage).toBe(58);
    expect(q.linesCovered).toBe(2900);
    expect(q.linesValid).toBe(5000);
    expect(q.measured).toBe(4);
    expect(q.perComponent.every((c) => c.sharedRepository)).toBe(true);
    expect(q.perComponent.every((c) => c.percentage === 58)).toBe(true);
    expect(q.status).toBe('red');
  });

  it('stale 58% stays red and adds quality-report-stale', () => {
    const q = evaluate(
      input(
        [{ componentId: 'coordinator', repository: 'example-org/s', applicable: true }],
        [repo('example-org/s', 'stale', 580, 1000, daysAgo(20))],
      ),
    );
    expect(q.percentage).toBe(58);
    expect(q.status).toBe('red');
    expect(q.stale).toBe(1);
    expect(reasonOf(q, 'quality-below-red-threshold')!.level).toBe('red');
    expect(reasonOf(q, 'quality-report-stale')).toMatchObject({
      level: 'amber',
      params: { components: 'coordinator' },
    });
    expect(codes(q)).not.toContain('quality-below-threshold');
  });

  it('stale 85% is capped at amber', () => {
    const q = evaluate(
      input(
        [{ componentId: 'coordinator', repository: 'example-org/s', applicable: true }],
        [repo('example-org/s', 'stale', 850, 1000, daysAgo(20))],
      ),
    );
    expect(q.percentage).toBe(85);
    expect(q.status).toBe('amber');
    expect(codes(q)).toContain('quality-report-stale');
    expect(codes(q)).not.toContain('quality-all-above-threshold');
  });

  it('lines.valid 0 → component not-applicable, percentage null, no NaN', () => {
    const q = evaluate(
      input(
        [{ componentId: 'coordinator', repository: 'example-org/empty', applicable: true }],
        [repo('example-org/empty', 'readable', 0, 0)],
      ),
    );
    expect(q.perComponent[0]!.state).toBe('not-applicable');
    expect(q.perComponent[0]!.percentage).toBeNull();
    expect(q.percentage).toBeNull();
    expect(q.applicable).toBe(0);
    expect(q.status).toBe('grey');
    expect(codes(q)).toEqual(['quality-not-applicable']);
    expect(JSON.stringify(q)).not.toContain('NaN');
  });

  it('all applicable not visible → grey', () => {
    const q = evaluate(
      input(
        [
          { componentId: 'coordinator', repository: 'example-org/a', applicable: true },
          { componentId: 'api', repository: 'example-org/b', applicable: true },
        ],
        [repo('example-org/a', 'invalid'), repo('example-org/b', 'unknown')],
      ),
    );
    expect(q.status).toBe('grey');
    expect(q.percentage).toBeNull();
    expect(q).toMatchObject({ applicable: 2, measured: 0, notVisible: 2 });
    expect(codes(q)).toEqual(['quality-report-invalid', 'quality-report-unknown']);
  });

  it('all applicable not visible → grey, not-visible reasons level info', () => {
    const q = evaluate(
      input(
        [
          { componentId: 'coordinator', repository: 'example-org/a', applicable: true },
          { componentId: 'api', repository: 'example-org/b', applicable: true },
          { componentId: 'web', repository: 'example-org/c', applicable: true },
        ],
        [
          repo('example-org/a', 'missing'),
          repo('example-org/b', 'not-authorised'),
          repo('example-org/c', 'unknown'),
        ],
      ),
    );
    expect(q.status).toBe('grey');
    // Grey already says "not visible": the reasons must not add amber rows to the why box.
    expect(q.reasons.map((r) => [r.code, r.level])).toEqual([
      ['quality-report-missing', 'info'],
      ['quality-report-not-authorised', 'info'],
      ['quality-report-unknown', 'info'],
    ]);
  });

  it('not grey → not-visible reasons keep level amber', () => {
    const q = evaluate(
      input(
        [
          { componentId: 'coordinator', repository: 'example-org/a', applicable: true },
          { componentId: 'api', repository: 'example-org/b', applicable: true },
        ],
        [repo('example-org/a', 'readable', 50, 100), repo('example-org/b', 'unknown')],
      ),
    );
    expect(q.status).toBe('red');
    expect(reasonOf(q, 'quality-report-unknown')!.level).toBe('amber');
  });

  it('no applicable component → grey with quality-not-applicable', () => {
    const q = evaluate(
      input([{ componentId: 'helm', repository: 'example-org/helm', applicable: false }], []),
    );
    expect(q.status).toBe('grey');
    expect(codes(q)).toEqual(['quality-not-applicable']);
  });

  it('not-authorised → quality-report-not-authorised, never quality-report-missing', () => {
    const q = evaluate(
      input(
        [
          { componentId: 'coordinator', repository: 'example-org/a', applicable: true },
          { componentId: 'api', repository: 'example-org/b', applicable: true },
        ],
        [repo('example-org/a', 'readable', 90, 100), repo('example-org/b', 'not-authorised')],
      ),
    );
    expect(q.status).toBe('amber');
    expect(reasonOf(q, 'quality-report-not-authorised')!.params.components).toBe('api');
    expect(codes(q)).not.toContain('quality-report-missing');
    expect(q.perComponent[1]!.percentage).toBeNull();
  });

  it('missingReportIsAmber false → missing does not cap, reason level info', () => {
    const p = policies((x) => {
      x.quality.missingReportIsAmber = false;
    });
    const q = evaluate(
      input(
        [
          { componentId: 'coordinator', repository: 'example-org/a', applicable: true },
          { componentId: 'api', repository: 'example-org/b', applicable: true },
        ],
        [repo('example-org/a', 'readable', 90, 100), repo('example-org/b', 'missing')],
      ),
      p,
    );
    expect(q.status).toBe('green');
    expect(reasonOf(q, 'quality-report-missing')!.level).toBe('info');
  });

  it('uses the configured thresholds', () => {
    const p = policies((x) => {
      x.quality.greenThresholdPercent = 50;
      x.quality.amberThresholdPercent = 40;
    });
    const q = evaluate(
      input(
        [{ componentId: 'coordinator', repository: 'example-org/a', applicable: true }],
        [repo('example-org/a', 'readable', 58, 100)],
      ),
      p,
    );
    expect(q.status).toBe('green');
  });

  describe('findings', () => {
    const one = [{ componentId: 'coordinator', repository: 'example-org/a', applicable: true }];
    const readable = [repo('example-org/a', 'readable', 90, 100)];

    it('403 → state not-authorised, counts null', () => {
      const q = evaluate(
        input(one, readable, {
          findings: new Map([
            ['example-org/a', fail({ classification: 'not-authorised', httpStatus: 403 })],
          ]),
        }),
      );
      expect(q.findings).toEqual({
        state: 'not-authorised',
        reliability: null,
        maintainability: null,
        bySeverity: { error: null, warning: null, note: null, none: null },
      });
    });

    it('findings 404 → unknown, never 0 (the setup endpoint is not called)', () => {
      const q = evaluate(
        input(one, readable, {
          findings: new Map([
            ['example-org/a', fail({ classification: 'not-found', httpStatus: 404 })],
          ]),
        }),
      );
      expect(q.findings.state).toBe('unknown');
      expect(q.findings.reliability).toBeNull();
      expect(q.findings.bySeverity.error).toBeNull();
    });

    it('a "not configured" message → that repository is skipped', () => {
      const notEnabled = fail<CodeQualityFindingDTO[]>({
        classification: 'not-configured',
        httpStatus: 404,
      });
      const alone = evaluate(
        input(one, readable, { findings: new Map([['example-org/a', notEnabled]]) }),
      );
      expect(alone.findings.state).toBe('not-configured');
      expect(alone.findings.reliability).toBeNull();
      // Skipped, not unreadable: the other repository's counts are published.
      const two = evaluate(
        input(
          [
            { componentId: 'coordinator', repository: 'example-org/a', applicable: true },
            { componentId: 'api', repository: 'example-org/b', applicable: true },
          ],
          readable,
          {
            findings: new Map([
              ['example-org/a', notEnabled],
              ['example-org/b', ok([{ category: 'reliability', severity: 'error' }])],
            ]),
          },
        ),
      );
      expect(two.findings).toMatchObject({ state: 'available', reliability: 1 });
    });

    it('findings past the page cap → unknown, never an under-count', () => {
      const q = evaluate(
        input(one, readable, {
          findings: new Map([
            [
              'example-org/a',
              fail<CodeQualityFindingDTO[]>({
                classification: 'error',
                message: 'FindingsPageCapExceeded',
              }),
            ],
          ]),
        }),
      );
      expect(q.findings.state).toBe('unknown');
      expect(q.findings.maintainability).toBeNull();
    });

    it('one repository 404 among readable ones → unknown (never a partial sum)', () => {
      const q = evaluate(
        input(
          [
            { componentId: 'coordinator', repository: 'example-org/a', applicable: true },
            { componentId: 'helm', repository: 'example-org/b', applicable: false },
          ],
          readable,
          {
            findings: new Map<string, ProviderResult<CodeQualityFindingDTO[]>>([
              ['example-org/a', ok([{ category: 'reliability', severity: 'error' }])],
              ['example-org/b', fail({ classification: 'not-found', httpStatus: 404 })],
            ]),
          },
        ),
      );
      expect(q.findings.state).toBe('unknown');
      expect(q.findings.reliability).toBeNull();
    });

    it('counts open findings once per repository by category and severity', () => {
      const list: CodeQualityFindingDTO[] = [
        { category: 'reliability', severity: 'error' },
        { category: 'maintainability', severity: 'warning' },
        { category: 'maintainability', severity: 'note' },
      ];
      const q = evaluate(
        input(
          [
            { componentId: 'coordinator', repository: 'example-org/a', applicable: true },
            { componentId: 'api', repository: 'example-org/a', applicable: true },
          ],
          readable,
          {
            findings: new Map([['example-org/a', ok(list)]]),
          },
        ),
      );
      expect(q.findings).toEqual({
        state: 'available',
        reliability: 1,
        maintainability: 2,
        bySeverity: { error: 1, warning: 1, note: 1, none: 0 },
      });
    });

    it('no data at all → unknown, never 0', () => {
      const q = evaluate(input(one, readable));
      expect(q.findings.state).toBe('unknown');
      expect(q.findings.bySeverity.error).toBeNull();
    });
  });
});

describe('normaliseQualitySummary', () => {
  const REPO = 'example-org/project-beta-api';

  it('reads a valid, fresh summary', () => {
    const { quality, error } = normaliseQualitySummary(
      REPO,
      artifact(JSON.stringify(summary(REPO, 5998, 8400))),
      P,
      NOW,
    );
    expect(error).toBeNull();
    expect(quality).toEqual({
      repository: REPO,
      state: 'readable',
      linesCovered: 5998,
      linesValid: 8400,
      commitSha: SHA,
      generatedAt: daysAgo(1),
      tool: 'coverlet',
      runUrl: 'https://github.com/example-org/repo/actions/runs/42',
    });
  });

  it('repository mismatch → invalid + invalid-data error', () => {
    const { quality, error } = normaliseQualitySummary(
      REPO,
      artifact(JSON.stringify(summary('example-org/other', 1, 2))),
      P,
      NOW,
    );
    expect(quality.state).toBe('invalid');
    expect(quality.linesValid).toBeNull();
    expect(error).toMatchObject({
      repository: REPO,
      source: 'quality-summary',
      classification: 'invalid-data',
    });
  });

  it('compares the repository case-insensitively', () => {
    const { quality } = normaliseQualitySummary(
      REPO,
      artifact(JSON.stringify(summary('Example-Org/Project-Beta-Api', 1, 2))),
      P,
      NOW,
    );
    expect(quality.state).toBe('readable');
  });

  it('invalid JSON or schema → invalid + invalid-data error, nothing leaked', () => {
    for (const text of ['{not json', JSON.stringify(summary(REPO, 1, 2, { path: 'src/x.ts' }))]) {
      const { quality, error } = normaliseQualitySummary(REPO, artifact(text), P, NOW);
      expect(quality.state).toBe('invalid');
      expect(error?.classification).toBe('invalid-data');
      expect(JSON.stringify({ quality, error })).not.toContain('src/x.ts');
    }
  });

  it('tool "ghp_exampleSecretValue" is scrubbed', () => {
    const { quality } = normaliseQualitySummary(
      REPO,
      artifact(JSON.stringify(summary(REPO, 1, 2, { tool: CANARIES[0] }))),
      P,
      NOW,
    );
    expect(quality.tool).toBeNull();
    for (const c of CANARIES) expect(JSON.stringify(quality)).not.toContain(c);
  });

  it('generatedAt older than qualityReportStaleDays → stale', () => {
    const { quality } = normaliseQualitySummary(
      REPO,
      artifact(JSON.stringify(summary(REPO, 1, 2, { generatedAt: daysAgo(20) }))),
      P,
      NOW,
    );
    expect(quality.state).toBe('stale');
    expect(quality.linesCovered).toBe(1);
  });

  it.each([
    [fail({ classification: 'not-found', httpStatus: 404 }), 'missing', null],
    [artifact(null), 'expired', null],
    [
      fail({ classification: 'not-authorised', httpStatus: 403 }),
      'not-authorised',
      'not-authorised',
    ],
    [fail({ classification: 'invalid-data' }), 'invalid', 'invalid-data'],
    [fail({ classification: 'error', httpStatus: 502 }), 'unknown', 'error'],
    [fail({ classification: 'rate-limited', httpStatus: 429 }), 'unknown', 'rate-limited'],
  ] as const)('%o → %s', (result, state, classification) => {
    const { quality, error } = normaliseQualitySummary(REPO, result, P, NOW);
    expect(quality.state).toBe(state);
    expect(error?.classification ?? null).toBe(classification);
    if (error) expect(error.source).toBe('quality-summary');
  });

  it('a skipped call (repository not accessible) is unknown and not reported again', () => {
    const { quality, error } = normaliseQualitySummary(
      REPO,
      fail({ classification: 'not-authorised', skipped: true }),
      P,
      NOW,
    );
    expect(quality.state).toBe('unknown');
    expect(error).toBeNull();
  });

  it('drops run links outside the allow-listed hosts', () => {
    const { quality } = normaliseQualitySummary(
      REPO,
      ok({
        summaryText: JSON.stringify(summary(REPO, 1, 2)),
        createdAt: null,
        runUrl: 'https://evil.example/actions/runs/1',
      }),
      P,
      NOW,
    );
    expect(quality.runUrl).toBeNull();
  });
});

describe('isCoverageApplicable', () => {
  it('applies to code components and the coordinator; an override always wins', () => {
    expect(isCoverageApplicable('deployment')).toBe(false);
    expect(isCoverageApplicable('infrastructure')).toBe(false);
    expect(isCoverageApplicable('other')).toBe(false);
    expect(isCoverageApplicable('worker')).toBe(true);
    expect(isCoverageApplicable('service')).toBe(true);
    expect(isCoverageApplicable('webapp')).toBe(true);
    expect(isCoverageApplicable('library')).toBe(true);
    expect(isCoverageApplicable('coordinator')).toBe(true);
    expect(isCoverageApplicable('deployment', 'required')).toBe(true);
    expect(isCoverageApplicable('coordinator', 'not-applicable')).toBe(false);
  });
});

/** A SonarQube report as normalised by normaliseSonarProject. */
function sonar(
  key: string,
  state: RepoQualityState,
  covered: number | null = null,
  valid: number | null = null,
  gate: SonarQuality['qualityGate'] = null,
  newCoverage: number | null = null,
): SonarQuality {
  const visible = state === 'readable' || state === 'stale';
  return {
    repository: key,
    state,
    linesCovered: visible ? covered : null,
    linesValid: visible ? valid : null,
    commitSha: null,
    generatedAt: visible ? daysAgo(1) : null,
    tool: visible ? 'sonarqube' : null,
    runUrl: null,
    source: 'sonarqube',
    qualityGate: visible ? gate : null,
    newCoverage: visible ? newCoverage : null,
  };
}

describe('quality with SonarQube (spec 5.7)', () => {
  const comp = (componentId: string, repository: string, sonarKey: string | null = null) => ({
    componentId,
    repository,
    applicable: true,
    sonarKey,
  });
  const run = (
    components: QualityInput['components'],
    ci: RepoQuality[],
    sonars: SonarQuality[],
    extra: Partial<QualityInput> = {},
    p: Policies = P,
  ) =>
    evaluate(
      {
        components,
        ciReports: new Map(ci.map((r) => [r.repository.toLowerCase(), r])),
        sonarReports: new Map(sonars.map((r) => [r.repository, r])),
        sources: ['ci-summary', 'sonarqube'],
        findings: new Map(),
        collectedAt: NOW.toISOString(),
        ...extra,
      },
      p,
    );

  it('beta-like with Sonar web 1950/3000: 8404/12600 = 66.7, measured 3, no quality-report-missing, quality-gate-failed (web) at info, amber', () => {
    const q = run(
      [
        comp('coordinator', BETA),
        comp('api', BETA_API),
        comp('web', BETA_WEB, 'beta-web'),
        { ...comp('helm', BETA_HELM), applicable: false },
      ],
      [
        repo(BETA, 'readable', 456, 1200),
        repo(BETA_API, 'readable', 5998, 8400),
        repo(BETA_WEB, 'missing'),
      ],
      [sonar('beta-web', 'readable', 1950, 3000, 'failed', 41.2)],
    );
    expect(q.percentage).toBe(66.7);
    expect(q.linesCovered).toBe(8404);
    expect(q.linesValid).toBe(12600);
    expect(q).toMatchObject({ measured: 3, applicable: 3, notVisible: 0, status: 'amber' });
    expect(codes(q)).not.toContain('quality-report-missing');
    expect(reasonOf(q, 'quality-gate-failed')).toMatchObject({
      level: 'info',
      params: { components: 'web' },
    });
    expect(q.perComponent[2]).toMatchObject({
      componentId: 'web',
      source: 'sonarqube',
      qualityGate: 'failed',
      newCoverage: 41.2,
      percentage: 65,
    });
    expect(q.perComponent[0]).toMatchObject({ source: 'ci-summary', qualityGate: null });
    expect(q.perComponent[3]).toMatchObject({ state: 'not-applicable', source: null });
  });

  it('alpha-backend: CI 6800/8000 readable and Sonar 6900/8000 readable → CI wins (sources default), qualityGate from Sonar', () => {
    const q = run(
      [comp('backend', 'example-org/alpha-backend', 'alpha-backend')],
      [repo('example-org/alpha-backend', 'readable', 6800, 8000)],
      [sonar('alpha-backend', 'readable', 6900, 8000, 'passed', 88.5)],
    );
    expect(q.linesCovered).toBe(6800);
    expect(q.perComponent[0]).toMatchObject({
      source: 'ci-summary',
      qualityGate: 'passed',
      newCoverage: 88.5,
      linesCovered: 6800,
    });
  });

  it('sources [sonarqube, ci-summary] → Sonar wins for alpha-backend', () => {
    const q = run(
      [comp('backend', 'example-org/alpha-backend', 'alpha-backend')],
      [repo('example-org/alpha-backend', 'readable', 6800, 8000)],
      [sonar('alpha-backend', 'readable', 6900, 8000, 'passed')],
      { sources: ['sonarqube', 'ci-summary'] },
    );
    expect(q.linesCovered).toBe(6900);
    expect(q.perComponent[0]!.source).toBe('sonarqube');
  });

  it('a readable Sonar report beats a stale CI summary even when ci-summary is first', () => {
    const q = run(
      [comp('backend', 'example-org/b', 'k')],
      [repo('example-org/b', 'stale', 6800, 8000, daysAgo(30))],
      [sonar('k', 'readable', 6900, 8000, 'passed')],
    );
    expect(q.perComponent[0]).toMatchObject({ source: 'sonarqube', state: 'readable' });
  });

  it('nothing readable: CI unknown + Sonar not-authorised → row not-authorised, reason quality-report-not-authorised', () => {
    const q = run(
      [comp('service', 'example-org/g', 'g-key')],
      [repo('example-org/g', 'unknown')],
      [sonar('g-key', 'not-authorised')],
    );
    expect(q.perComponent[0]).toMatchObject({ state: 'not-authorised', source: 'sonarqube' });
    expect(codes(q)).toContain('quality-report-not-authorised');
    expect(codes(q)).not.toContain('quality-report-unknown');
    expect(q.status).toBe('grey');
  });

  it('two components in one repository with different Sonar keys count separately (3000 + 2000 valid)', () => {
    const q = run(
      [comp('a', 'example-org/mono', 'k1'), comp('b', 'example-org/mono', 'k2')],
      [repo('example-org/mono', 'missing')],
      [
        sonar('k1', 'readable', 2400, 3000, 'passed'),
        sonar('k2', 'readable', 1500, 2000, 'passed'),
      ],
    );
    expect(q.linesValid).toBe(5000);
    expect(q.linesCovered).toBe(3900);
    expect(q.perComponent.every((r) => !r.sharedRepository)).toBe(true);
  });

  it('two components sharing one Sonar key share the report and count once', () => {
    const q = run(
      [comp('a', 'example-org/x', 'same'), comp('b', 'example-org/y', 'same')],
      [],
      [sonar('same', 'readable', 50, 100, null)],
    );
    expect(q.linesValid).toBe(100);
    expect(q.perComponent.every((r) => r.sharedRepository)).toBe(true);
  });

  it('a Sonar key without a loaded report (provider off) falls back to the CI summary', () => {
    const q = run(
      [comp('backend', 'example-org/b', 'k')],
      [repo('example-org/b', 'readable', 10, 20)],
      [],
    );
    expect(q.perComponent[0]).toMatchObject({ source: 'ci-summary', qualityGate: null });
  });

  it('qualityGateFailed amber caps a green project at amber; grey stays grey', () => {
    const strict = policies((p) => (p.quality.qualityGateFailed = 'amber'));
    const q = run(
      [comp('backend', 'example-org/b', 'k')],
      [repo('example-org/b', 'readable', 95, 100)],
      [sonar('k', 'readable', 95, 100, 'failed')],
      {},
      strict,
    );
    expect(q.status).toBe('amber');
    expect(reasonOf(q, 'quality-gate-failed')!.level).toBe('amber');
    const info = run(
      [comp('backend', 'example-org/b', 'k')],
      [repo('example-org/b', 'readable', 95, 100)],
      [sonar('k', 'readable', 95, 100, 'failed')],
    );
    expect(info.status).toBe('green');
  });

  it('without any Sonar data the result equals the CI-only result', () => {
    const q = run(
      [comp('backend', 'example-org/b')],
      [repo('example-org/b', 'readable', 9, 10)],
      [],
    );
    expect(q.perComponent[0]).toMatchObject({
      source: 'ci-summary',
      qualityGate: null,
      newCoverage: null,
    });
  });
});

describe('selectReport', () => {
  const c = (key: string, source: 'ci-summary' | 'sonarqube', state: RepoQualityState) => ({
    key,
    source,
    report: repo(key, state, 1, 2),
  });
  const order = ['ci-summary', 'sonarqube'] as const;
  it('first readable by precedence; else first stale; else not-authorised, invalid, expired, unknown; else missing', () => {
    expect(
      selectReport([c('a', 'ci-summary', 'stale'), c('b', 'sonarqube', 'readable')], order)?.key,
    ).toBe('b');
    expect(
      selectReport([c('a', 'ci-summary', 'stale'), c('b', 'sonarqube', 'stale')], order)?.key,
    ).toBe('a');
    expect(
      selectReport([c('a', 'ci-summary', 'unknown'), c('b', 'sonarqube', 'not-authorised')], order)
        ?.key,
    ).toBe('b');
    expect(
      selectReport([c('a', 'ci-summary', 'expired'), c('b', 'sonarqube', 'invalid')], order)?.key,
    ).toBe('b');
    expect(
      selectReport([c('a', 'ci-summary', 'missing'), c('b', 'sonarqube', 'unknown')], order)?.key,
    ).toBe('b');
    expect(
      selectReport([c('a', 'ci-summary', 'missing'), c('b', 'sonarqube', 'missing')], order)?.key,
    ).toBe('a');
    expect(selectReport([], order)).toBeNull();
  });
  it('the sources list decides the precedence, and a source not listed is ignored', () => {
    const list = [c('a', 'ci-summary', 'readable'), c('b', 'sonarqube', 'readable')];
    expect(selectReport(list, ['sonarqube', 'ci-summary'])?.key).toBe('b');
    expect(selectReport(list, ['sonarqube'])?.key).toBe('b');
  });
});

describe('normaliseSonarProject', () => {
  const dto = (over: Partial<SonarProjectDTO> = {}): SonarProjectDTO => ({
    linesToCover: 8000,
    uncoveredLines: 1100,
    newCoverage: 88.5,
    qualityGate: 'OK',
    analysedAt: daysAgo(1),
    revision: SHA,
    ...over,
  });
  const norm = (r: ProviderResult<SonarProjectDTO>, p: Policies = P) =>
    normaliseSonarProject('proj', r, p, NOW);

  it('maps lines, gate OK → passed, ERROR → failed, tool sonarqube, commit and date from the analysis', () => {
    const { quality, error } = norm(ok(dto()));
    expect(error).toBeNull();
    expect(quality).toMatchObject({
      repository: 'proj',
      state: 'readable',
      linesValid: 8000,
      linesCovered: 6900,
      qualityGate: 'passed',
      newCoverage: 88.5,
      source: 'sonarqube',
      tool: 'sonarqube',
      commitSha: SHA,
      generatedAt: dto().analysedAt,
      runUrl: null,
    });
    expect(norm(ok(dto({ qualityGate: 'ERROR' }))).quality.qualityGate).toBe('failed');
    expect(norm(ok(dto({ qualityGate: null }))).quality.qualityGate).toBeNull();
  });

  it('uncovered 9000 > lines 8000 → invalid + invalid-data error with source sonarqube', () => {
    const { quality, error } = norm(ok(dto({ uncoveredLines: 9000 })));
    expect(quality).toMatchObject({ state: 'invalid', linesValid: null, qualityGate: null });
    expect(error).toMatchObject({ source: 'sonarqube', classification: 'invalid-data' });
  });

  it('a missing line measure → unknown without an error; an old analysis → stale', () => {
    expect(norm(ok(dto({ linesToCover: null }))).quality.state).toBe('unknown');
    expect(norm(ok(dto({ uncoveredLines: null }))).error).toBeNull();
    expect(norm(ok(dto({ analysedAt: daysAgo(30) }))).quality.state).toBe('stale');
    expect(norm(ok(dto({ analysedAt: null }))).quality.state).toBe('readable');
  });

  it('404 → missing (never counted, never 0, no error); 403 → not-authorised + error; skipped → unknown, no error', () => {
    expect(norm(fail({ classification: 'not-found' }))).toMatchObject({
      quality: { state: 'missing', linesValid: null },
      error: null,
    });
    expect(norm(fail({ classification: 'not-authorised', httpStatus: 403 }))).toMatchObject({
      quality: { state: 'not-authorised' },
      error: { source: 'sonarqube', classification: 'not-authorised' },
    });
    expect(norm(fail({ classification: 'error' }))).toMatchObject({
      quality: { state: 'unknown' },
      error: { source: 'sonarqube' },
    });
    expect(norm(fail({ classification: 'error', skipped: true }))).toMatchObject({
      quality: { state: 'unknown' },
      error: null,
    });
  });
});
