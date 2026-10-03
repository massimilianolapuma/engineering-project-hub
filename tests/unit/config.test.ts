import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CatalogSchema, PoliciesSchema } from '@model/index';
import { ConfigError, loadConfig, parseYamlWith } from '../../collector/src/config/load';

const catalogText = readFileSync('config/projects.yaml', 'utf8');
const policiesText = readFileSync('config/policies.yaml', 'utf8');

describe('projects.yaml validation', () => {
  it('accepts the shipped catalog', async () => {
    const { catalog } = await loadConfig('config');
    expect(catalog.projects.map((p) => p.id)).toEqual([
      'project-alpha',
      'project-beta',
      'project-gamma',
    ]);
    expect(catalog.projects[0]!.coordinator.manifestPath).toBe('release-manifest.yaml');
    expect(catalog.projects[0]!.securityStatusPath).toBe('.security/project-security-status.json');
  });

  const invalid = (mutate: (t: string) => string) => () =>
    parseYamlWith(CatalogSchema, mutate(catalogText), 'projects.yaml');

  it('rejects malformed repository references with a clear path', () => {
    expect(invalid((t) => t.replace('example-org/project-alpha-backend', 'not a repo'))).toThrow(
      /projects\[0\]\.components\[0\]\.repository: must be "owner\/name"/,
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
      invalid((t) => t.replace('lifecycle: production', 'lifecycle: production\n    lifecycel: x')),
    ).toThrow(/Unrecognized key/);
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
