import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  PoliciesSchema,
  ProjectSnapshotSchema,
  type ControlCell,
  type ProjectSnapshot,
  type SecurityFinding,
} from '@model/index';
import { emptyExtras, evaluateControlMap } from '../../collector/src/evaluators/control-map';
import {
  medianResolvedDays,
  workloadIdentityOf,
} from '../../collector/src/evaluators/control-map-sources';
import { parseWorkflow } from '../../collector/src/normalizers/workflow-refs';
import { loadConfig } from '../../collector/src/config/load';

/*
 * New readings of the control map (spec §5.2 "Definitions for the new sources"): OIDC use in
 * deploying workflows, GitHub environment protection, push protection, closed-alert dates.
 */
const policies = PoliciesSchema.parse(parse(readFileSync('config/policies.yaml', 'utf8')));
const snap = (id: string): ProjectSnapshot =>
  ProjectSnapshotSchema.parse(
    JSON.parse(readFileSync(`fixtures/snapshots/projects/${id}.json`, 'utf8')),
  );
const cell = (cells: ControlCell[], id: string) => cells.find((c) => c.check === id)!;

const wf = (yaml: string) => parseWorkflow('deploy.yml', yaml);

describe('workload identity (OIDC)', () => {
  it('counts a login without secret inputs and id-token: write as OIDC', () => {
    const f = wf(`
permissions:
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: azure/login@v2
        with:
          client-id: \${{ vars.AZ_CLIENT }}
          tenant-id: \${{ vars.AZ_TENANT }}
`);
    expect(f.identity).toEqual({ deploying: true, oidc: true });
  });

  it('counts a login with a secret credential as long-lived', () => {
    const f = wf(`
permissions:
  id-token: write
jobs:
  deploy:
    steps:
      - uses: azure/login@v2
        with:
          creds: \${{ secrets.AZ }}
`);
    expect(f.identity).toEqual({ deploying: true, oidc: false });
  });

  it('counts a job environment without id-token as deploying, not OIDC', () => {
    const f = wf(`
jobs:
  deploy:
    environment: production
    steps:
      - run: ./deploy.sh
`);
    expect(f.identity).toEqual({ deploying: true, oidc: false });
  });

  it('reads id-token at job level', () => {
    const f = wf(`
jobs:
  deploy:
    permissions:
      id-token: write
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/deploy
`);
    expect(f.identity).toEqual({ deploying: true, oidc: true });
  });

  it('a workflow with neither login nor environment is not deploying', () => {
    expect(wf('jobs:\n  test:\n    steps:\n      - run: npm test\n').identity).toEqual({
      deploying: false,
      oidc: false,
    });
  });

  it('sums deploying and OIDC workflows; no workflow read gives null', () => {
    const files = [
      { identity: { deploying: true, oidc: true } },
      { identity: { deploying: true, oidc: false } },
      { identity: { deploying: false, oidc: false } },
    ];
    expect(workloadIdentityOf([{ read: true, files }])).toEqual({
      deploying: 2,
      oidc: 1,
      readable: { k: 1, n: 1 },
    });
    expect(workloadIdentityOf([])).toBeNull();
  });

  it('no deploying workflow gives workload-identity n/a', async () => {
    const { catalog } = await loadConfig('config');
    const project = catalog.projects.find((p) => p.id === 'platform')!;
    const map = evaluateControlMap(
      {
        snapshot: snap('platform'),
        project,
        extras: {
          ...emptyExtras(),
          workloadIdentity: { deploying: 0, oidc: 0, readable: { k: 1, n: 1 } },
        },
      },
      policies,
    );
    expect(cell(map.cells, 'workload-identity')).toMatchObject({
      state: 'not-applicable',
      reason: 'no-object',
    });
  });
});

describe('environment separation', () => {
  const project = async () => {
    const { catalog } = await loadConfig('config');
    const p = catalog.projects.find((x) => x.id === 'project-alpha')!;
    return {
      ...p,
      environments: [
        { ...p.environments[0]!, id: 'dev', name: 'DEV' },
        { ...p.environments[0]!, id: 'prod', name: 'PROD', githubEnvironment: 'production' },
      ],
    };
  };
  const level = async (environments: ReturnType<typeof emptyExtras>['environments']) =>
    cell(
      evaluateControlMap(
        {
          snapshot: snap('project-alpha'),
          project: await project(),
          extras: { ...emptyExtras(), environments },
        },
        policies,
      ).cells,
      'environment-separation',
    );
  const env = (name: string, prot = false, branchPolicy = false) => ({
    name,
    protected: prot,
    branchPolicy,
  });

  it.each([
    ['none in GitHub', [], 2],
    ['separate, production unprotected', [env('dev'), env('production')], 3],
    ['production protected', [env('dev'), env('production', true)], 4],
    ['production protected and branch-limited', [env('dev'), env('production', true, true)], 5],
  ] as const)('%s → %d', async (_, envs, expected) => {
    expect((await level([...envs])).level).toBe(expected);
  });

  it('a 403 is not visible (needs permission), never 0', async () => {
    expect(await level('not-authorised')).toMatchObject({
      level: null,
      reason: 'needs-permission',
    });
  });
});

describe('push protection', () => {
  it('scanning and push protection on every repository gives secret scanning 5', async () => {
    const { catalog } = await loadConfig('config');
    const project = catalog.projects.find((p) => p.id === 'platform')!;
    const s = snap('platform');
    for (const comp of s.securityControls)
      for (const ctl of comp.controls) if (ctl.control === 'secretScanning') ctl.state = 'enabled';
    const repos = [...new Set(s.securityControls.map((c) => c.repository))];
    const map = evaluateControlMap(
      {
        snapshot: s,
        project,
        extras: {
          ...emptyExtras(),
          pushProtection: new Map(repos.map((r) => [r, 'enabled' as const])),
        },
      },
      policies,
    );
    expect(cell(map.cells, 'secret-scanning')).toMatchObject({ level: 5, note: null });
  });

  it('scanning on everywhere but push protection off gives 3 (scanning only), not 0', async () => {
    const { catalog } = await loadConfig('config');
    const project = catalog.projects.find((p) => p.id === 'platform')!;
    const s = snap('platform');
    for (const comp of s.securityControls)
      for (const ctl of comp.controls) if (ctl.control === 'secretScanning') ctl.state = 'enabled';
    const repos = [...new Set(s.securityControls.map((c) => c.repository))];
    const map = evaluateControlMap(
      {
        snapshot: s,
        project,
        extras: {
          ...emptyExtras(),
          pushProtection: new Map(repos.map((r) => [r, 'disabled' as const])),
        },
      },
      policies,
    );
    expect(cell(map.cells, 'secret-scanning')).toMatchObject({ level: 3, value: 100 });
    expect(cell(map.cells, 'secret-scanning').note).toContain('push protection on 0%');
  });
});

describe('security MTTR', () => {
  const f = (detectedAt: string, resolvedAt: string | null, severity = 'high') =>
    ({
      severity,
      detectedAt,
      resolvedAt,
      status: resolvedAt ? 'fixed' : 'open',
    }) as unknown as SecurityFinding;
  const now = new Date('2026-03-01T00:00:00Z');

  it('takes the median days of critical/high alerts closed in the window', () => {
    expect(
      medianResolvedDays(
        [
          f('2026-02-01T00:00:00Z', '2026-02-03T00:00:00Z'),
          f('2026-02-01T00:00:00Z', '2026-02-11T00:00:00Z', 'critical'),
          f('2026-02-01T00:00:00Z', '2026-02-02T00:00:00Z', 'low'),
          f('2026-02-01T00:00:00Z', null),
          f('2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z'),
        ],
        now,
        90,
      ),
    ).toBe(6);
  });

  it('gives null when nothing was closed in the window', () => {
    expect(medianResolvedDays([f('2026-02-01T00:00:00Z', null)], now, 90)).toBeNull();
  });

  it('6 days is level 4', async () => {
    const { catalog } = await loadConfig('config');
    const project = catalog.projects.find((p) => p.id === 'platform')!;
    const map = evaluateControlMap(
      { snapshot: snap('platform'), project, extras: { ...emptyExtras(), resolvedMedianDays: 6 } },
      policies,
    );
    expect(cell(map.cells, 'security-mttr')).toMatchObject({ level: 4, value: 6, unit: 'days' });
  });
});
