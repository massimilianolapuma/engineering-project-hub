import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { CatalogSchema, CatalogSnapshotSchema } from '@model/index';
import {
  addSuggestedComponent,
  catalogToYaml,
  emptyProject,
  formatIssuePath,
  githubEditUrl,
  isSubmoduleMapped,
  jsonForScript,
  renameComponentId,
  slugFromSubmodulePath,
  slugify,
  toCatalogInput,
  toDraft,
  validateDraft,
} from '../../src/lib/catalog-editor-core';

const snapshot = CatalogSnapshotSchema.parse(
  JSON.parse(readFileSync('fixtures/snapshots/catalog.json', 'utf8')),
);
const draft = () => toDraft(snapshot.catalog);
const project = (id: string, d = draft()) => d.projects.find((p) => p.id === id)!;

describe('catalog editor: draft → catalog', () => {
  it('round-trips the published catalog to an equivalent catalog', () => {
    expect(CatalogSchema.parse(toCatalogInput(draft()))).toEqual(snapshot.catalog);
  });

  it('omits empty optional fields and schema defaults', () => {
    const out = toCatalogInput(draft()) as {
      discovery?: unknown;
      projects: (Record<string, unknown> & { id: string; components: object[] })[];
    };
    expect(out.discovery).toBeUndefined();
    const gamma = out.projects.find((p) => p.id === 'project-gamma')!;
    expect(gamma.coordinator).toEqual({ repository: 'example-org/project-gamma-coordinator' });
    expect(gamma.securityStatusPath).toBeUndefined();
    expect(gamma.components[0]).toEqual({
      id: 'service',
      name: 'Gamma service',
      repository: 'example-org/project-gamma-service',
      type: 'service',
    });
    const alpha = out.projects.find((p) => p.id === 'project-alpha')!;
    // manifestPath equals the default, so it is not repeated.
    expect(alpha.coordinator).not.toHaveProperty('manifestPath');
  });

  it('keeps required fields even when empty so validation names them', () => {
    const d = draft();
    d.projects[0]!.components[0]!.repository = '';
    const out = toCatalogInput(d) as { projects: { components: { repository: string }[] }[] };
    expect(out.projects[0]!.components[0]!.repository).toBe('');
  });

  it('trims values', () => {
    const d = draft();
    d.projects[0]!.coordinator.defaultBranch = '  develop ';
    const out = toCatalogInput(d) as { projects: { coordinator: { defaultBranch: string } }[] };
    expect(out.projects[0]!.coordinator.defaultBranch).toBe('develop');
  });
});

describe('catalog editor: YAML', () => {
  const yaml = catalogToYaml(draft());

  it('generates the whole catalog, valid against the schema', () => {
    const parsed = CatalogSchema.parse(parse(yaml));
    expect(parsed.projects.map((p) => p.id)).toEqual([
      'project-alpha',
      'project-beta',
      'project-gamma',
    ]);
    expect(parsed).toEqual(snapshot.catalog);
  });

  it('starts with a header comment and keeps the hand-written style', () => {
    expect(yaml.startsWith('# yaml-language-server: $schema=./schema/projects.schema.json')).toBe(
      true,
    );
    expect(yaml).toContain('notApplicableControls: [containerScanning]');
    expect(yaml).toContain('- { id: dev, name: DEV }');
    expect(yaml).toContain('codeScanning: { required: true }');
    expect(yaml).toContain('appliesTo: [api, web]');
  });

  it('does not emit empty values or defaults noisily', () => {
    expect(yaml).not.toMatch(/: ''$/m);
    expect(yaml).not.toMatch(/: \[\]$/m);
    expect(yaml).not.toContain('critical: false');
    expect(yaml).not.toContain('versionSource: auto');
    expect(yaml).not.toContain('manifestPath:');
    expect(yaml).not.toContain('securityStatusPath:');
    expect(yaml).not.toContain('discovery:');
  });

  it('emits non-default values', () => {
    const d = draft();
    const c = d.projects[0]!.components[0]!;
    c.versionSource = 'submodule';
    c.releaseTagPrefix = 'backend-v';
    d.projects[0]!.coordinator.manifestPath = 'deploy/manifest.yaml';
    const out = catalogToYaml(d);
    expect(out).toContain('versionSource: submodule');
    expect(out).toContain('releaseTagPrefix: backend-v');
    expect(out).toContain('manifestPath: deploy/manifest.yaml');
  });
});

describe('catalog editor: submodule suggestions', () => {
  it('derives a slug id from the submodule path', () => {
    expect(slugify('Legacy Scripts_v2')).toBe('legacy-scripts-v2');
    expect(slugFromSubmodulePath('tools/legacy-scripts')).toBe('legacy-scripts');
    expect(slugFromSubmodulePath('tools/legacy-scripts', ['legacy-scripts'])).toBe(
      'tools-legacy-scripts',
    );
    expect(
      slugFromSubmodulePath('tools/legacy-scripts', ['legacy-scripts', 'tools-legacy-scripts']),
    ).toBe('legacy-scripts-2');
    expect(slugFromSubmodulePath('x/coordinator')).toBe('x-coordinator');
    expect(slugFromSubmodulePath('___')).toBe('component');
    expect(slugFromSubmodulePath(`a/${'b'.repeat(80)}`)).toHaveLength(63);
  });

  it('adds an unmapped submodule as a component linked by path', () => {
    const d = draft();
    const beta = project('project-beta', d);
    const [suggestion] = snapshot.suggestions.find(
      (s) => s.projectId === 'project-beta',
    )!.unmappedSubmodules;
    expect(suggestion).toEqual({
      path: 'tools/legacy-scripts',
      repository: 'example-org/legacy-scripts',
    });
    expect(isSubmoduleMapped(beta, suggestion!.path)).toBe(false);
    const c = addSuggestedComponent(beta, suggestion!);
    expect(c).toMatchObject({
      id: 'legacy-scripts',
      repository: 'example-org/legacy-scripts',
      submodulePath: 'tools/legacy-scripts',
      versionSource: 'auto',
    });
    expect(isSubmoduleMapped(beta, 'tools/legacy-scripts')).toBe(true);
    expect(validateDraft(d)).toEqual([]);
    expect(catalogToYaml(d)).toContain('submodulePath: tools/legacy-scripts');
  });

  it('leaves the repository empty (and flagged) when the remote is unknown', () => {
    const d = draft();
    const beta = project('project-beta', d);
    addSuggestedComponent(beta, { path: 'vendor/thing', repository: null });
    const issues = validateDraft(d);
    expect(issues.map((i) => i.text)).toEqual([
      'projects[1].components[3].repository: must be "owner/name"',
    ]);
  });
});

describe('catalog editor: validation', () => {
  it('formats issue paths like the collector', () => {
    expect(formatIssuePath(['projects', 1, 'components', 0, 'repository'])).toBe(
      'projects[1].components[0].repository',
    );
    expect(formatIssuePath([])).toBe('(root)');
  });

  it('reports human-readable issues with a field key', () => {
    const d = draft();
    d.projects[1]!.components[0]!.repository = 'not a repo';
    d.projects[0]!.id = 'Bad Id';
    const issues = validateDraft(d);
    expect(issues.map((i) => i.text)).toEqual([
      'projects[0].id: must be a lowercase slug (a-z, 0-9, "-")',
      'projects[1].components[0].repository: must be "owner/name"',
    ]);
    expect(issues[1]!.key).toBe('projects.1.components.0.repository');
  });

  it('catches duplicates and unknown appliesTo targets', () => {
    const d = draft();
    const alpha = d.projects[0]!;
    alpha.components[1]!.id = 'backend';
    const texts = validateDraft(d).map((i) => i.text);
    expect(texts).toContain('projects[0].components: duplicate component id "backend"');
    d.projects.push({ ...emptyProject(), id: 'project-alpha' });
    expect(validateDraft(d).map((i) => i.text)).toContain(
      'projects[3].id: duplicate project id "project-alpha"',
    );
  });

  it('keeps appliesTo in sync when a component id is renamed', () => {
    const d = draft();
    const alpha = d.projects[0]!;
    renameComponentId(alpha, 'backend', 'api-backend');
    alpha.components[0]!.id = 'api-backend';
    expect(alpha.trackedWorkflows[0]!.appliesTo).toEqual(['api-backend', 'frontend', 'worker']);
    expect(validateDraft(d)).toEqual([]);
  });

  it('a new project needs at least a name, business unit and repositories', () => {
    const d = draft();
    d.projects.push(emptyProject(d.projects.map((p) => p.id)));
    const keys = validateDraft(d).map((i) => i.key);
    expect(d.projects[3]!.id).toBe('new-project');
    expect(keys).toEqual(
      expect.arrayContaining([
        'projects.3.name',
        'projects.3.businessUnit',
        'projects.3.coordinator.repository',
        'projects.3.components.0.id',
        'projects.3.components.0.repository',
      ]),
    );
  });

  it('rejects an empty catalog', () => {
    expect(validateDraft({ ...draft(), projects: [] }).map((i) => i.key)).toEqual(['projects']);
  });
});

describe('catalog editor: build-time helpers', () => {
  it('derives the GitHub editor URL from package.json repository.url', () => {
    expect(githubEditUrl('git+https://github.com/acme/hub.git')).toBe(
      'https://github.com/acme/hub/edit/main/config/projects.yaml',
    );
    expect(githubEditUrl('git@github.com:acme/hub.git')).toBe(
      'https://github.com/acme/hub/edit/main/config/projects.yaml',
    );
    expect(githubEditUrl('https://gitlab.com/acme/hub')).toBeNull();
    expect(githubEditUrl(undefined)).toBeNull();
  });

  it('escapes embedded JSON against </script> injection', () => {
    const json = jsonForScript({ name: '</script><script>alert(1)</script>&' });
    expect(json).not.toContain('<');
    expect(json).not.toContain('>');
    expect(JSON.parse(json)).toEqual({ name: '</script><script>alert(1)</script>&' });
  });
});
