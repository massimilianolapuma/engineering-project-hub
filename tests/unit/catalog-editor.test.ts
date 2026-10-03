import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { CatalogSchema, CatalogSnapshotSchema, ProjectConfigSchema } from '@model/index';
import {
  MAX_GITHUB_URL_LENGTH,
  addSuggestedComponent,
  catalogToYaml,
  emptyComponent,
  emptyProject,
  findProjectByCoordinator,
  formatIssuePath,
  githubDeleteFileUrl,
  githubEditFileUrl,
  githubNewFileUrl,
  githubRepoFromUrl,
  importProposal,
  isSubmoduleMapped,
  jsonForScript,
  mergeComponent,
  mergeWorkflow,
  missingFromProposal,
  pendingChanges,
  projectKind,
  projectToYaml,
  renameComponentId,
  safeGithubUrl,
  slugFromSubmodulePath,
  slugify,
  toCatalogInput,
  toDraft,
  toProjectInput,
  uniqueId,
  validateDraft,
} from '../../src/lib/catalog-editor-core';

const snapshot = CatalogSnapshotSchema.parse(
  JSON.parse(readFileSync('fixtures/snapshots/catalog.json', 'utf8')),
);
const draft = () => toDraft(snapshot.catalog);
const project = (id: string, d = draft()) => d.projects.find((p) => p.id === id)!;
const indexOf = (id: string) => snapshot.catalog.projects.findIndex((p) => p.id === id);
const proposal = (repository: string) =>
  snapshot.discovery!.proposals.find((p) => p.repository === repository)!;

describe('catalog editor: draft → catalog', () => {
  it('round-trips the published projects to equivalent projects', () => {
    expect(CatalogSchema.parse(toCatalogInput(draft())).projects).toEqual(
      snapshot.catalog.projects,
    );
  });

  it('keeps discovery settings out of the project files', () => {
    expect(toCatalogInput(draft())).not.toHaveProperty('discovery');
    expect(draft().discovery).toEqual(snapshot.catalog.discovery);
  });

  it('omits empty optional fields and schema defaults', () => {
    const gamma = toProjectInput(project('project-gamma')) as Record<string, unknown> & {
      components: object[];
    };
    expect(gamma.coordinator).toEqual({ repository: 'example-org/project-gamma-coordinator' });
    expect(gamma.securityStatusPath).toBeUndefined();
    expect(gamma.components[0]).toEqual({
      id: 'service',
      name: 'Gamma service',
      repository: 'example-org/project-gamma-service',
      type: 'service',
    });
    // manifestPath equals the default, so it is not repeated.
    expect(toProjectInput(project('project-alpha')).coordinator).not.toHaveProperty('manifestPath');
  });

  it('keeps required fields even when empty so validation names them', () => {
    const p = project('project-alpha');
    p.components[0]!.repository = '';
    const out = toProjectInput(p) as { components: { repository: string }[] };
    expect(out.components[0]!.repository).toBe('');
  });

  it('trims values', () => {
    const p = project('project-alpha');
    p.coordinator.defaultBranch = '  develop ';
    expect((toProjectInput(p).coordinator as { defaultBranch: string }).defaultBranch).toBe(
      'develop',
    );
  });
});

describe('catalog editor: per-project YAML', () => {
  it('generates a single ProjectConfig document per project, valid against the schema', () => {
    for (const published of snapshot.catalog.projects) {
      const yaml = projectToYaml(project(published.id));
      const doc = parse(yaml) as Record<string, unknown>;
      expect(doc).not.toHaveProperty('projects');
      expect(ProjectConfigSchema.parse(doc)).toEqual(published);
    }
  });

  it('starts with a header comment like the files in config/projects/', () => {
    const yaml = projectToYaml(project('project-alpha'));
    expect(yaml.startsWith('# yaml-language-server: $schema=../schema/project.schema.json\n')).toBe(
      true,
    );
    expect(yaml).toContain('# Engineering Project Hub — project "project-alpha".');
    expect(yaml).toMatch(/\n\nid: project-alpha\n/);
  });

  it('keeps the hand-written style', () => {
    const alpha = projectToYaml(project('project-alpha'));
    expect(alpha).toContain('notApplicableControls: [containerScanning]');
    expect(alpha).toContain('- { id: dev, name: DEV }');
    expect(alpha).toContain('codeScanning: { required: true }');
    expect(alpha).toContain('appliesTo: [backend, frontend, worker]');
    expect(alpha).toMatch(/\n\ncoordinator:\n/);
    expect(alpha).toMatch(/\n\ncomponents:\n/);
    const platform = projectToYaml(project('platform'));
    expect(platform).toContain('    path: services/api\n');
    expect(platform).toContain('appliesTo: [coordinator]');
  });

  it('does not emit empty values or defaults noisily', () => {
    for (const p of draft().projects) {
      const yaml = projectToYaml(p);
      expect(yaml).not.toMatch(/: ''$/m);
      expect(yaml).not.toMatch(/: \[\]$/m);
      expect(yaml).not.toContain('critical: false');
      expect(yaml).not.toContain('versionSource: auto');
      expect(yaml).not.toContain('manifestPath:');
      expect(yaml).not.toContain('securityStatusPath:');
      expect(yaml).not.toContain('discovery:');
    }
  });

  it('emits non-default values', () => {
    const p = project('project-alpha');
    const c = p.components[0]!;
    c.versionSource = 'submodule';
    c.releaseTagPrefix = 'backend-v';
    p.coordinator.manifestPath = 'deploy/manifest.yaml';
    const out = projectToYaml(p);
    expect(out).toContain('versionSource: submodule');
    expect(out).toContain('releaseTagPrefix: backend-v');
    expect(out).toContain('manifestPath: deploy/manifest.yaml');
  });

  it('omits components for a single-repository project', () => {
    const p = importProposal(draft(), proposal('example-org/docs-site').project);
    const yaml = projectToYaml(p);
    expect(yaml).not.toContain('components:');
    expect(ProjectConfigSchema.parse(parse(yaml)).components).toEqual([]);
  });

  it('still offers the legacy all-in-one projects.yaml', () => {
    const yaml = catalogToYaml(draft());
    expect(yaml.startsWith('# yaml-language-server: $schema=./schema/projects.schema.json')).toBe(
      true,
    );
    expect(yaml).toContain('INSTEAD of config/projects/*.yaml');
    expect(CatalogSchema.parse(parse(yaml)).projects).toEqual(snapshot.catalog.projects);
    expect(yaml).toMatch(/projects:\n {2}- id: platform\n/);
    expect(yaml).not.toContain('discovery:');
  });
});

describe('catalog editor: saving through GitHub', () => {
  const yaml = 'id: docs-site\nname: Docs & "site"\n';

  it('derives the repository from package.json repository.url', () => {
    expect(githubRepoFromUrl('git+https://github.com/acme/hub.git')).toBe('acme/hub');
    expect(githubRepoFromUrl('git@github.com:acme/hub.git')).toBe('acme/hub');
    expect(githubRepoFromUrl('https://gitlab.com/acme/hub')).toBeNull();
    expect(githubRepoFromUrl(undefined)).toBeNull();
  });

  it('builds the prefilled new-file URL of config/projects/<id>.yaml', () => {
    const target = githubNewFileUrl('acme/hub', 'docs-site', yaml)!;
    expect(target.prefilled).toBe(true);
    expect(target.url).toBe(
      `https://github.com/acme/hub/new/main?filename=config/projects/docs-site.yaml&value=${encodeURIComponent(yaml)}`,
    );
    expect(new URL(target.url).searchParams.get('value')).toBe(yaml);
    expect(new URL(target.url).searchParams.get('filename')).toBe('config/projects/docs-site.yaml');
  });

  it('falls back to the empty new-file page when the URL would be too long', () => {
    const long = `description: ${'x'.repeat(MAX_GITHUB_URL_LENGTH)}\n`;
    const target = githubNewFileUrl('acme/hub', 'docs-site', long)!;
    expect(target.prefilled).toBe(false);
    expect(target.url).toBe(
      'https://github.com/acme/hub/new/main?filename=config/projects/docs-site.yaml',
    );
    // A real project fits.
    const real = githubNewFileUrl(
      'acme/hub',
      'project-alpha',
      projectToYaml(project('project-alpha')),
    )!;
    expect(real.prefilled).toBe(true);
    expect(real.url.length).toBeLessThanOrEqual(MAX_GITHUB_URL_LENGTH);
  });

  it('builds edit and delete URLs of an existing project file', () => {
    expect(githubEditFileUrl('acme/hub', 'project-alpha')).toBe(
      'https://github.com/acme/hub/edit/main/config/projects/project-alpha.yaml',
    );
    expect(githubDeleteFileUrl('acme/hub', 'project-alpha')).toBe(
      'https://github.com/acme/hub/delete/main/config/projects/project-alpha.yaml',
    );
  });

  it('refuses invalid ids and repositories', () => {
    expect(githubNewFileUrl('acme/hub', '../evil', yaml)).toBeNull();
    expect(githubNewFileUrl('acme/hub', 'Bad Id', yaml)).toBeNull();
    expect(githubEditFileUrl('acme/hub', 'a/b')).toBeNull();
    expect(githubDeleteFileUrl('evil.com/x?y', 'project-alpha')).toBeNull();
    expect(githubEditFileUrl('acme', 'project-alpha')).toBeNull();
  });

  it('only links discovered repositories on github.com over https', () => {
    expect(safeGithubUrl('https://github.com/example-org/docs-site')).toBe(
      'https://github.com/example-org/docs-site',
    );
    expect(safeGithubUrl('https://evil.example/x')).toBeNull();
    expect(safeGithubUrl('javascript:alert(1)')).toBeNull();
    expect(safeGithubUrl(null)).toBeNull();
  });
});

describe('catalog editor: pending changes', () => {
  it('is empty for the published catalog', () => {
    expect(pendingChanges(draft(), draft())).toEqual([]);
  });

  it('ignores whitespace-only edits', () => {
    const d = draft();
    project('project-gamma', d).name = ' Project Gamma  ';
    expect(pendingChanges(draft(), d)).toEqual([]);
  });

  it('lists new, modified and removed project files', () => {
    const d = draft();
    project('project-gamma', d).name = 'Gamma';
    d.projects = d.projects.filter((p) => p.id !== 'project-beta');
    importProposal(d, proposal('example-org/docs-site').project);
    expect(pendingChanges(draft(), d)).toEqual([
      { kind: 'modified', id: 'project-gamma', name: 'Gamma', index: 2 },
      { kind: 'new', id: 'docs-site', name: 'Docs Site', index: 3 },
      { kind: 'removed', id: 'project-beta', name: 'Project Beta', index: null },
    ]);
  });

  it('treats a renamed project as a new file plus a removed one', () => {
    const d = draft();
    project('project-gamma', d).id = 'gamma';
    expect(pendingChanges(draft(), d).map((c) => [c.kind, c.id])).toEqual([
      ['new', 'gamma'],
      ['removed', 'project-gamma'],
    ]);
  });
});

describe('catalog editor: discovery proposals', () => {
  it('imports a proposal as a new project', () => {
    const d = draft();
    const p = importProposal(d, proposal('example-org/docs-site').project);
    expect(p.id).toBe('docs-site');
    expect(d.projects.at(-1)).toBe(p);
    expect(projectKind(p)).toBe('single');
    expect(p.coordinator.manifestPath).toBe('');
    expect(validateDraft(d)).toEqual([]);
  });

  it('de-duplicates the id of an imported project', () => {
    expect(uniqueId('platform', ['platform'])).toBe('platform-2');
    expect(uniqueId('platform', ['platform', 'platform-2'])).toBe('platform-3');
    expect(uniqueId('x'.repeat(63), ['x'.repeat(63)])).toBe(`${'x'.repeat(61)}-2`);
    const d = draft();
    const first = importProposal(d, proposal('example-org/docs-site').project);
    const second = importProposal(d, proposal('example-org/docs-site').project);
    expect([first.id, second.id]).toEqual(['docs-site', 'docs-site-2']);
    // Still a duplicate coordinator for the collector, but valid as a catalog.
    expect(validateDraft(d)).toEqual([]);
  });

  it('finds the project that already uses the repository as coordinator', () => {
    const d = draft();
    expect(findProjectByCoordinator(d, 'Example-Org/Platform-Mono')?.id).toBe('platform');
    expect(findProjectByCoordinator(d, 'example-org/docs-site')).toBeUndefined();
  });

  it('lists the items of a proposal missing from the project and merges them', () => {
    const d = draft();
    const platform = project('platform', d);
    const missing = missingFromProposal(platform, proposal('example-org/platform-mono').project);
    expect(missing.components).toEqual([]);
    expect(missing.workflows.map((w) => w.file)).toEqual(['docs.yml']);
    const w = mergeWorkflow(platform, missing.workflows[0]!);
    expect(w).toMatchObject({ id: 'docs', file: 'docs.yml', appliesTo: ['coordinator'] });
    expect(
      missingFromProposal(platform, proposal('example-org/platform-mono').project).workflows,
    ).toEqual([]);
    expect(validateDraft(d)).toEqual([]);
  });

  it('matches submodule components by repository or submodule path', () => {
    const alpha = project('project-alpha');
    const missing = missingFromProposal(
      alpha,
      proposal('example-org/project-alpha-coordinator').project,
    );
    expect(missing.components).toEqual([]);
  });

  it('renames a merged component whose id is taken', () => {
    const d = draft();
    const gamma = project('project-gamma', d);
    const proposed = proposal('example-org/platform-mono').project.components[0]!;
    gamma.components[0]!.id = proposed.id;
    const c = mergeComponent(gamma, proposed);
    expect(c.id).toBe(`${proposed.id}-2`);
    expect(c.path).toBe(proposed.path);
  });
});

describe('catalog editor: monorepo and single repository', () => {
  it('derives the project type from the components', () => {
    expect(projectKind(project('platform'))).toBe('monorepo');
    expect(projectKind(project('project-alpha'))).toBe('multi');
    expect(projectKind({ ...project('project-gamma'), components: [] })).toBe('single');
  });

  it('accepts a project with zero components', () => {
    const d = draft();
    project('project-gamma', d).components = [];
    project('project-gamma', d).trackedWorkflows.forEach((w) => (w.appliesTo = ['coordinator']));
    expect(validateDraft(d)).toEqual([]);
  });

  it('requires a path for a component in the coordinator repository', () => {
    const d = draft();
    const i = indexOf('platform');
    d.projects[i]!.components[1]!.path = '';
    const issues = validateDraft(d);
    expect(issues.map((x) => x.key)).toEqual([`projects.${i}.components.1.path`]);
    expect(issues[0]!.message).toContain('monorepo');
  });

  it('rejects a component that is both a submodule and a directory', () => {
    const d = draft();
    const i = indexOf('platform');
    d.projects[i]!.components[0]!.submodulePath = 'apps/web';
    expect(validateDraft(d).map((x) => x.key)).toEqual([
      `projects.${i}.components.0.submodulePath`,
    ]);
  });

  it('a new project starts as a single repository', () => {
    const p = emptyProject();
    expect(p.components).toEqual([]);
    expect(projectKind(p)).toBe('single');
    expect(emptyComponent().path).toBe('');
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
      path: '',
      versionSource: 'auto',
    });
    expect(isSubmoduleMapped(beta, 'tools/legacy-scripts')).toBe(true);
    expect(validateDraft(d)).toEqual([]);
    expect(projectToYaml(beta)).toContain('submodulePath: tools/legacy-scripts');
  });

  it('leaves the repository empty (and flagged) when the remote is unknown', () => {
    const d = draft();
    const beta = project('project-beta', d);
    addSuggestedComponent(beta, { path: 'vendor/thing', repository: null });
    const issues = validateDraft(d);
    expect(issues.map((i) => i.text)).toEqual([
      `projects[${indexOf('project-beta')}].components[3].repository: must be "owner/name"`,
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
    const alpha = indexOf('project-alpha');
    const beta = indexOf('project-beta');
    d.projects[beta]!.components[0]!.repository = 'not a repo';
    d.projects[alpha]!.id = 'Bad Id';
    const issues = validateDraft(d);
    expect(issues.map((i) => i.text)).toEqual([
      `projects[${alpha}].id: must be a lowercase slug (a-z, 0-9, "-")`,
      `projects[${beta}].components[0].repository: must be "owner/name"`,
    ]);
    expect(issues[1]!.key).toBe(`projects.${beta}.components.0.repository`);
  });

  it('catches duplicates and unknown appliesTo targets', () => {
    const d = draft();
    const alpha = project('project-alpha', d);
    alpha.components[1]!.id = 'backend';
    const texts = validateDraft(d).map((i) => i.text);
    expect(texts).toContain(
      `projects[${indexOf('project-alpha')}].components: duplicate component id "backend"`,
    );
    d.projects.push({ ...emptyProject(), id: 'project-alpha' });
    expect(validateDraft(d).map((i) => i.text)).toContain(
      `projects[${d.projects.length - 1}].id: duplicate project id "project-alpha"`,
    );
  });

  it('keeps appliesTo in sync when a component id is renamed', () => {
    const d = draft();
    const alpha = project('project-alpha', d);
    renameComponentId(alpha, 'backend', 'api-backend');
    alpha.components[0]!.id = 'api-backend';
    expect(alpha.trackedWorkflows[0]!.appliesTo).toEqual(['api-backend', 'frontend', 'worker']);
    expect(validateDraft(d)).toEqual([]);
  });

  it('a new project needs at least a name, business unit and coordinator repository', () => {
    const d = draft();
    d.projects.push(emptyProject(d.projects.map((p) => p.id)));
    const i = d.projects.length - 1;
    expect(d.projects[i]!.id).toBe('new-project');
    expect(validateDraft(d).map((x) => x.key)).toEqual([
      `projects.${i}.name`,
      `projects.${i}.businessUnit`,
      `projects.${i}.coordinator.repository`,
    ]);
  });

  it('accepts an empty catalog (every project file removed)', () => {
    expect(validateDraft({ ...draft(), projects: [] })).toEqual([]);
  });
});

describe('catalog editor: build-time helpers', () => {
  it('escapes embedded JSON against </script> injection', () => {
    const json = jsonForScript({ name: '</script><script>alert(1)</script>&' });
    expect(json).not.toContain('<');
    expect(json).not.toContain('>');
    expect(JSON.parse(json)).toEqual({ name: '</script><script>alert(1)</script>&' });
  });
});
