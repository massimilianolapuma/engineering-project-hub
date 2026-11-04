import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  CONTROL_CHECKS,
  ControlCellSchema,
  PoliciesSchema,
  ProjectConfigSchema,
} from '@model/index';

/*
 * Control map model (spec §5): 25 technical checks with DORA and ISO 27001 references, levels
 * 0–5, deploy signals per environment. References are data, never a compliance claim.
 */
const SPEC_ORDER = [
  'sbom-coverage',
  'image-signature',
  'build-provenance',
  'license-policy',
  'dependency-scanning',
  'sast',
  'container-scanning',
  'iac-scanning',
  'dast',
  'vulnerability-age',
  'security-mttr',
  'secret-scanning',
  'exposed-secrets',
  'workload-identity',
  'branch-protection',
  'required-checks',
  'pipeline-integrity',
  'environment-separation',
  'config-drift',
  'deploy-frequency',
  'lead-time',
  'change-failure-rate',
  'time-to-restore',
  'test-coverage',
  'evidence-freshness',
];

describe('CONTROL_CHECKS', () => {
  it('lists the 25 checks of the spec in order, each with DORA and ISO references', () => {
    expect(CONTROL_CHECKS.map((c) => c.id)).toEqual(SPEC_ORDER);
    for (const c of CONTROL_CHECKS) {
      expect(c.dora.length, c.id).toBeGreaterThan(0);
      expect(c.iso.length, c.id).toBeGreaterThan(0);
      expect(JSON.stringify(c).toLowerCase()).not.toContain('compliant');
    }
    expect(CONTROL_CHECKS.find((c) => c.id === 'sbom-coverage')).toMatchObject({
      area: 'supply-chain',
      dora: ['art. 8', 'RTS art. 4–5', 'RTS art. 16'],
      iso: ['5.9', '5.21'],
    });
  });
});

describe('catalog additions', () => {
  const base = () =>
    parse(readFileSync('config/projects/project-alpha.yaml', 'utf8')) as Record<string, unknown>;
  const env = (extra: Record<string, unknown>) => ({ id: 'prod', name: 'PROD', ...extra });

  it('accepts the spec example deploy signals and control map exclusions', () => {
    const p = ProjectConfigSchema.parse({
      ...base(),
      environments: [
        env({
          delivery: true,
          githubEnvironment: 'production',
          deploySignal: {
            type: 'versions-file',
            repository: 'coordinator',
            path: 'environments/prod.yaml',
            key: 'umbrella',
          },
        }),
      ],
      controlMap: { notApplicable: [{ check: 'dast', reason: 'no web UI' }] },
    });
    expect(p.environments[0]?.deploySignal).toMatchObject({
      type: 'versions-file',
      tagPrefix: 'v',
    });
    expect(p.controlMap.notApplicable).toEqual([{ check: 'dast', reason: 'no web UI' }]);
  });

  it('defaults to an external signal and no exclusions', () => {
    const p = ProjectConfigSchema.parse({ ...base(), environments: [env({})] });
    expect(p.environments[0]?.deploySignal).toEqual({ type: 'external' });
    expect(p.controlMap).toEqual({ notApplicable: [] });
  });

  it.each([
    [
      'two delivery environments',
      { environments: [env({ delivery: true }), { id: 'dev', name: 'DEV', delivery: true }] },
      'only one delivery environment',
    ],
    [
      'a workflow signal naming an unknown workflow',
      { environments: [env({ deploySignal: { type: 'workflow', workflow: 'nope' } })] },
      'unknown tracked workflow',
    ],
    [
      'a versions-file signal without key',
      {
        environments: [
          env({
            deploySignal: { type: 'versions-file', repository: 'coordinator', path: 'a.yaml' },
          }),
        ],
      },
      '',
    ],
    ['an exclusion without reason', { controlMap: { notApplicable: [{ check: 'dast' }] } }, ''],
  ])('rejects %s', (_, extra, message) => {
    const r = ProjectConfigSchema.safeParse({ ...base(), ...extra });
    expect(r.success).toBe(false);
    if (message) expect(JSON.stringify(r.error?.issues)).toContain(message);
  });
});

describe('policies and cells', () => {
  it('defaults the control map policies', () => {
    const p = PoliciesSchema.parse(
      parse(readFileSync('config/policies.yaml', 'utf8')) as Record<string, unknown>,
    );
    expect(p.controlMap).toEqual({
      enabled: true,
      windows: { frequencyDays: 30, trendDays: 90 },
      thresholds: {},
    });
  });

  it('rejects a level above 5 and an unknown reason', () => {
    const cell = {
      check: 'sbom-coverage',
      level: 4,
      state: 'measured',
      value: 90,
      unit: 'percent',
      threshold: 85,
      readable: { k: 4, n: 4 },
      reason: null,
      note: null,
      environment: null,
      signal: null,
    };
    expect(ControlCellSchema.safeParse(cell).success).toBe(true);
    expect(ControlCellSchema.safeParse({ ...cell, level: 6 }).success).toBe(false);
    expect(ControlCellSchema.safeParse({ ...cell, reason: 'because' }).success).toBe(false);
  });
});
