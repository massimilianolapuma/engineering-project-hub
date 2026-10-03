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

  it('rejects an unsupported status value', () => {
    expect(() =>
      parseYamlWith(
        PoliciesSchema,
        policiesText.replace('componentDrift: amber', 'componentDrift: purple'),
        'policies.yaml',
      ),
    ).toThrow(/version\.componentDrift/);
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
