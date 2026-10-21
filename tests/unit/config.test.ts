import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogSchema, PoliciesSchema, ProjectConfigSchema } from '@model/index';
import {
  ConfigError,
  loadCatalog,
  loadConfig,
  parseYamlWith,
} from '../../collector/src/config/load';

const catalogText = readFileSync('config/projects/project-alpha.yaml', 'utf8');
const policiesText = readFileSync('config/policies.yaml', 'utf8');

describe('catalog validation (config/projects/<id>.yaml)', () => {
  it('accepts the shipped catalog', async () => {
    const { catalog } = await loadConfig('config');
    expect(catalog.projects.map((p) => p.id)).toEqual([
      'platform',
      'project-alpha',
      'project-beta',
      'project-gamma',
    ]);
    expect(catalog.projects[1]!.coordinator.manifestPath).toBe('release-manifest.yaml');
    expect(catalog.projects[1]!.securityStatusPath).toBe('.security/project-security-status.json');
  });

  const invalid = (mutate: (t: string) => string) => () =>
    parseYamlWith(ProjectConfigSchema, mutate(catalogText), 'project-alpha.yaml');

  it('rejects malformed repository references with a clear path', () => {
    expect(invalid((t) => t.replace('example-org/project-alpha-backend', 'not a repo'))).toThrow(
      /components\[0\]\.repository: must be "owner\/name"/,
    );
  });

  it('rejects duplicate component ids', () => {
    expect(invalid((t) => t.replace('- id: frontend', '- id: backend'))).toThrow(
      /duplicate component id "backend"/,
    );
  });

  it('rejects appliesTo entries that are not components', () => {
    expect(invalid((t) => t.replace('appliesTo: [helm]', 'appliesTo: [nope]'))).toThrow(
      /unknown component "nope"/,
    );
  });

  it('rejects unknown keys (typos are not silently ignored)', () => {
    expect(
      invalid((t) => t.replace('lifecycle: production', 'lifecycle: production\nlifecycel: x')),
    ).toThrow(/Unrecognized key/);
  });

  it('requires a path for components living in the coordinator repository (monorepo)', () => {
    const mono = (path?: string) =>
      ProjectConfigSchema.safeParse({
        id: 'mono',
        name: 'Mono',
        businessUnit: 'x',
        lifecycle: 'development',
        coordinator: { repository: 'example-org/mono' },
        components: [
          {
            id: 'api',
            name: 'API',
            repository: 'example-org/mono',
            type: 'service',
            ...(path ? { path } : {}),
          },
        ],
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
          ].map((c) => [c, { required: false }]),
        ),
      });
    expect(mono().success).toBe(false);
    expect(mono('services/api').success).toBe(true);
  });

  it('merges catalog.yaml, per-project files and the legacy projects.yaml', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eph-config-'));
    await mkdir(join(dir, 'projects'));
    await cp('config/projects/project-beta.yaml', join(dir, 'projects/project-beta.yaml'));
    await writeFile(
      join(dir, 'projects.yaml'),
      `projects:\n${catalogText.replace(/^(?!#)(.+)$/gm, '    $1').replace(/^ {4}id:/m, '  - id:')}`,
    );
    await writeFile(
      join(dir, 'catalog.yaml'),
      'discovery:\n  enabled: true\n  owners: [example-org]\n',
    );
    const c = await loadCatalog(dir);
    expect(c.projects.map((p) => p.id).sort()).toEqual(['project-alpha', 'project-beta']);
    expect(c.discovery).toMatchObject({
      enabled: true,
      owners: ['example-org'],
      includePrivate: false,
    });
  });

  it('discovery hints default to hub-project / hub-component / hub-component-type / project- / type-', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eph-config-'));
    await writeFile(
      join(dir, 'catalog.yaml'),
      'discovery:\n  enabled: true\n  owners: [example-org]\n',
    );
    const c = await loadCatalog(dir);
    expect(c.discovery.hints).toEqual({
      projectProperty: 'hub-project',
      componentProperty: 'hub-component',
      typeProperty: 'hub-component-type',
      projectTopicPrefix: 'project-',
      typeTopicPrefix: 'type-',
    });
  });

  it("rejects projectProperty 'Bad Key'", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eph-config-'));
    await writeFile(
      join(dir, 'catalog.yaml'),
      "discovery:\n  enabled: true\n  owners: [example-org]\n  hints:\n    projectProperty: 'Bad Key'\n",
    );
    await expect(loadCatalog(dir)).rejects.toThrow();
  });

  it('rejects a project file whose name differs from its id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eph-config-'));
    await mkdir(join(dir, 'projects'));
    await cp('config/projects/project-beta.yaml', join(dir, 'projects/other.yaml'));
    await expect(loadCatalog(dir)).rejects.toThrow(/must match the file name/);
  });

  it('rejects an empty catalog unless discovery is enabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eph-config-'));
    await expect(loadCatalog(dir)).rejects.toThrow(/No projects/);
    await writeFile(
      join(dir, 'catalog.yaml'),
      'discovery:\n  enabled: true\n  owners: [example-org]\n',
    );
    await expect(loadCatalog(dir)).resolves.toMatchObject({ projects: [] });
  });

  it('rejects invalid YAML', () => {
    expect(() => parseYamlWith(CatalogSchema, 'projects: [', 'projects.yaml')).toThrow(ConfigError);
  });

  it('catalog accepts testCoverage on coordinator and component, rejects other values', () => {
    const withCoverage = (value: string) =>
      parseYamlWith(
        ProjectConfigSchema,
        catalogText
          .replace(
            'manifestPath: release-manifest.yaml',
            `manifestPath: release-manifest.yaml\n  testCoverage: ${value}`,
          )
          .replace('type: deployment', `type: deployment\n    testCoverage: ${value}`),
        'project-alpha.yaml',
      );
    const p = withCoverage('not-applicable');
    expect(p.coordinator.testCoverage).toBe('not-applicable');
    expect(p.components.find((c) => c.id === 'helm')!.testCoverage).toBe('not-applicable');
    expect(withCoverage('required').components.find((c) => c.id === 'helm')!.testCoverage).toBe(
      'required',
    );
    expect(() => withCoverage('sometimes')).toThrow(/testCoverage/);
    expect(
      parseYamlWith(ProjectConfigSchema, catalogText, 'project-alpha.yaml').components[0]!
        .testCoverage,
    ).toBeUndefined();
  });

  it("catalog accepts notApplicableChecks ['branch-protected'] on a component, rejects 'foo'", () => {
    const project = (checks: string[], where: 'component' | 'coordinator' = 'component') =>
      ProjectConfigSchema.safeParse({
        id: 'p',
        name: 'P',
        businessUnit: 'BU',
        lifecycle: 'production',
        coordinator: {
          repository: 'example-org/p',
          ...(where === 'coordinator' ? { notApplicableChecks: checks } : {}),
        },
        components: [
          {
            id: 'api',
            name: 'API',
            repository: 'example-org/api',
            type: 'service',
            ...(where === 'component' ? { notApplicableChecks: checks } : {}),
          },
        ],
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
          ].map((c) => [c, { required: false }]),
        ),
      });
    const ok = project(['branch-protected']);
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.components[0]!.notApplicableChecks).toEqual(['branch-protected']);
    expect(project(['foo']).success).toBe(false);
    expect(project(['actions-pinned'], 'coordinator').success).toBe(true);
    expect(project(['foo'], 'coordinator').success).toBe(false);
    const dflt = project([]);
    expect(dflt.success && dflt.data.coordinator.notApplicableChecks).toEqual([]);
  });

  it('reserves "coordinator" as component id', () => {
    expect(invalid((t) => t.replace('- id: backend', '- id: coordinator'))).toThrow(
      /"coordinator" is reserved/,
    );
  });
});

describe('policies.yaml validation', () => {
  it('accepts the shipped policies', () => {
    const p = parseYamlWith(PoliciesSchema, policiesText, 'policies.yaml');
    expect(p.security.redOnSeverities).toEqual(['critical']);
    expect(p.overall.criticalDimensions).toContain('security');
  });

  it('policies default quality thresholds 80/60, stale 14 days', () => {
    const p = parseYamlWith(PoliciesSchema, policiesText, 'policies.yaml');
    expect(p.quality).toEqual({
      greenThresholdPercent: 80,
      amberThresholdPercent: 60,
      missingReportIsAmber: true,
    });
    expect(p.freshness.qualityReportStaleDays).toBe(14);
    // Omitted from the file, the schema defaults are the same.
    const { quality: _omit, ...rest } = p;
    const d = PoliciesSchema.parse({ ...rest, freshness: {} });
    expect(d.quality).toEqual(p.quality);
    expect(d.freshness.qualityReportStaleDays).toBe(14);
  });

  it('rejects a quality amber threshold above the green one', () => {
    expect(() =>
      parseYamlWith(
        PoliciesSchema,
        policiesText.replace('amberThresholdPercent: 60', 'amberThresholdPercent: 90'),
        'policies.yaml',
      ),
    ).toThrow(/quality/);
  });

  it('policies default optionalDimensions to quality and weights.quality to 10', () => {
    const p = parseYamlWith(PoliciesSchema, policiesText, 'policies.yaml');
    expect(p.overall.optionalDimensions).toEqual(['quality']);
    expect(p.score.weights.quality).toBe(10);
  });

  it('quality in both requiredDimensions and optionalDimensions is rejected', () => {
    expect(() =>
      parseYamlWith(
        PoliciesSchema,
        policiesText.replace(
          'requiredDimensions: [delivery, version, security, coverage, governance]',
          'requiredDimensions: [delivery, version, security, coverage, governance, quality]',
        ),
        'policies.yaml',
      ),
    ).toThrow(/optionalDimensions/);
  });

  it('rejects an unsupported status value', () => {
    expect(() =>
      parseYamlWith(
        PoliciesSchema,
        policiesText.replace('componentDrift: amber', 'componentDrift: purple'),
        'policies.yaml',
      ),
    ).toThrow(/version\.componentDrift/);
  });

  it('history defaults: enabled true, maxEntries 120, maxAgeDays 90', () => {
    const p = parseYamlWith(PoliciesSchema, policiesText, 'policies.yaml');
    expect(p.history).toEqual({ enabled: true, maxEntries: 120, maxAgeDays: 90 });
    const { history: _omit, ...rest } = p;
    expect(PoliciesSchema.parse(rest).history).toEqual(p.history);
  });

  it('history.maxEntries 1 is rejected; 1001 is rejected', () => {
    const withHistory = (history: object) =>
      PoliciesSchema.safeParse({
        ...parseYamlWith(PoliciesSchema, policiesText, 'p.yaml'),
        history,
      });
    expect(withHistory({ maxEntries: 1 }).success).toBe(false);
    expect(withHistory({ maxEntries: 1001 }).success).toBe(false);
    expect(withHistory({ maxEntries: 2 }).success).toBe(true);
    expect(withHistory({ maxEntries: 1000 }).success).toBe(true);
  });

  it('history.maxAgeDays 0 is rejected', () => {
    const r = PoliciesSchema.safeParse({
      ...parseYamlWith(PoliciesSchema, policiesText, 'p.yaml'),
      history: { maxAgeDays: 0 },
    });
    expect(r.success).toBe(false);
  });

  it('config/policies.yaml declares the history block', () => {
    expect(policiesText).toMatch(/^# history:/m);
    const p = parseYamlWith(PoliciesSchema, policiesText, 'policies.yaml');
    expect(p.history.maxEntries).toBe(120);
  });

  it('policies default repositoryControls: all six checks info, maxWorkflowFiles 30, readClassicProtection false', () => {
    const p = parseYamlWith(PoliciesSchema, policiesText, 'policies.yaml');
    expect(p.repositoryControls).toEqual({
      enabled: true,
      checks: {
        'actions-pinned': 'info',
        'reusable-workflows-current': 'info',
        'branch-protected': 'info',
        'pull-request-required': 'info',
        'force-push-blocked': 'info',
        'status-checks-required': 'info',
      },
      unknownEnforcedCheck: 'info',
      exemptActionOwners: [],
      maxWorkflowFiles: 30,
      readClassicProtection: false,
    });
    expect(policiesText).toMatch(/^# repositoryControls:/m);
  });

  const withControls = (repositoryControls: unknown) =>
    PoliciesSchema.safeParse({
      ...parseYamlWith(PoliciesSchema, policiesText, 'p.yaml'),
      repositoryControls,
    });

  it('repositoryControls rejects maxWorkflowFiles 0 and 101, accepts 1 and 100', () => {
    expect(withControls({ maxWorkflowFiles: 0 }).success).toBe(false);
    expect(withControls({ maxWorkflowFiles: 101 }).success).toBe(false);
    expect(withControls({ maxWorkflowFiles: 1 }).success).toBe(true);
    expect(withControls({ maxWorkflowFiles: 100 }).success).toBe(true);
  });

  it('repositoryControls rejects a check level "grey", an unknown check and a bad owner', () => {
    expect(withControls({ checks: { 'actions-pinned': 'grey' } }).success).toBe(false);
    expect(withControls({ checks: { 'not-a-check': 'red' } }).success).toBe(false);
    expect(withControls({ exemptActionOwners: ['not an owner!'] }).success).toBe(false);
    expect(withControls({ unknownEnforcedCheck: 'red' }).success).toBe(false);
    expect(withControls({ checks: { 'actions-pinned': 'red' } }).success).toBe(true);
  });

  it('rejects a wrong schemaVersion', () => {
    expect(() =>
      parseYamlWith(
        PoliciesSchema,
        policiesText.replace("schemaVersion: '1.0'", "schemaVersion: '2.0'"),
        'p.yaml',
      ),
    ).toThrow(/schemaVersion/);
  });
});
