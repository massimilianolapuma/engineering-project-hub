import { Document, isMap, isScalar, isSeq, visit, type YAMLMap } from 'yaml';
import type { z } from 'zod';
import {
  CatalogSchema,
  type Catalog,
  type ComponentConfig,
  type ProjectConfig,
  type TrackedWorkflowConfig,
  type VersionSource,
} from '@model/catalog';
import { CONTROL_IDS, type ControlId } from '@model/enums';

/*
 * Pure logic of the catalog editor (no DOM): editable draft model, conversion to the compact
 * project documents written to config/projects/<id>.yaml, YAML generation, validation with the
 * real CatalogSchema, pending changes against the published catalog, discovery proposals and
 * GitHub web-editor URLs. Shared by the browser script (src/scripts/catalog-editor.ts) and
 * unit tests.
 */

export const DEFAULT_MANIFEST_PATH = 'release-manifest.yaml';
export const DEFAULT_SECURITY_STATUS_PATH = '.security/project-security-status.json';

export interface DraftComponent {
  id: string;
  name: string;
  repository: string;
  /** Directory inside the repository (monorepo); empty = whole repository. */
  path: string;
  type: string;
  defaultBranch: string;
  submodulePath: string;
  releaseTagPrefix: string;
  versionSource: VersionSource;
  notApplicableControls: ControlId[];
}
export interface DraftEnvironment {
  id: string;
  name: string;
}
export interface DraftWorkflow {
  id: string;
  name: string;
  file: string;
  critical: boolean;
  /** Empty = every component. */
  appliesTo: string[];
}
export interface DraftProject {
  id: string;
  name: string;
  description: string;
  businessUnit: string;
  lifecycle: string;
  coordinator: {
    repository: string;
    defaultBranch: string;
    /** Empty = schema default (release-manifest.yaml). */
    manifestPath: string;
    notApplicableControls: ControlId[];
  };
  components: DraftComponent[];
  environments: DraftEnvironment[];
  trackedWorkflows: DraftWorkflow[];
  securityControls: Record<ControlId, boolean>;
  /** Empty = schema default. */
  securityStatusPath: string;
}
export interface DraftCatalog {
  /** Read-only here: discovery settings live in config/catalog.yaml. */
  discovery: Catalog['discovery'];
  projects: DraftProject[];
}
export interface UnmappedSubmodule {
  path: string;
  repository: string | null;
}

const orEmpty = (v: string | undefined, dflt?: string) => (v === undefined || v === dflt ? '' : v);

/** Editable draft of one parsed (defaults applied) project configuration. */
export function projectToDraft(p: ProjectConfig): DraftProject {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    businessUnit: p.businessUnit,
    lifecycle: p.lifecycle,
    coordinator: {
      repository: p.coordinator.repository,
      defaultBranch: orEmpty(p.coordinator.defaultBranch),
      manifestPath: orEmpty(p.coordinator.manifestPath, DEFAULT_MANIFEST_PATH),
      notApplicableControls: [...p.coordinator.notApplicableControls],
    },
    components: p.components.map(componentToDraft),
    environments: p.environments.map((e) => ({ ...e })),
    trackedWorkflows: p.trackedWorkflows.map(workflowToDraft),
    securityControls: Object.fromEntries(
      CONTROL_IDS.map((id) => [id, p.securityControls[id].required]),
    ) as Record<ControlId, boolean>,
    securityStatusPath: orEmpty(p.securityStatusPath, DEFAULT_SECURITY_STATUS_PATH),
  };
}

function componentToDraft(c: ComponentConfig): DraftComponent {
  return {
    id: c.id,
    name: c.name,
    repository: c.repository,
    path: orEmpty(c.path),
    type: c.type,
    defaultBranch: orEmpty(c.defaultBranch),
    submodulePath: orEmpty(c.submodulePath),
    releaseTagPrefix: orEmpty(c.releaseTagPrefix),
    versionSource: c.versionSource,
    notApplicableControls: [...c.notApplicableControls],
  };
}

function workflowToDraft(w: TrackedWorkflowConfig): DraftWorkflow {
  return {
    id: w.id,
    name: w.name,
    file: w.file,
    critical: w.critical,
    appliesTo: [...(w.appliesTo ?? [])],
  };
}

/** Editable draft from the parsed (defaults applied) catalog published by the collector. */
export function toDraft(catalog: Catalog): DraftCatalog {
  return {
    discovery: { ...catalog.discovery, owners: [...catalog.discovery.owners] },
    projects: catalog.projects.map(projectToDraft),
  };
}

const t = (v: string) => v.trim();
/** Optional string: omitted when empty or equal to the schema default. */
const opt = (v: string, dflt?: string) => {
  const s = v.trim();
  return s === '' || s === dflt ? undefined : s;
};
const optList = <T>(v: T[]) => (v.length ? [...v] : undefined);
/** Drops undefined values so they are neither validated nor emitted. */
function compact<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Compact project document as written to config/projects/<id>.yaml: required fields always
 * present (so validation reports them by name), optional fields omitted when empty or default.
 * Array rows are never dropped, so issue paths match the editor rows.
 */
export function toProjectInput(p: DraftProject): Record<string, unknown> {
  return compact({
    id: t(p.id),
    name: t(p.name),
    description: opt(p.description),
    businessUnit: t(p.businessUnit),
    lifecycle: p.lifecycle,
    coordinator: compact({
      repository: t(p.coordinator.repository),
      defaultBranch: opt(p.coordinator.defaultBranch),
      manifestPath: opt(p.coordinator.manifestPath, DEFAULT_MANIFEST_PATH),
      notApplicableControls: optList(p.coordinator.notApplicableControls),
    }),
    // Empty for a single-repository project (the coordinator is the only repository).
    components: p.components.length
      ? p.components.map((c) =>
          compact({
            id: t(c.id),
            name: t(c.name),
            repository: t(c.repository),
            path: opt(c.path),
            type: c.type,
            defaultBranch: opt(c.defaultBranch),
            submodulePath: opt(c.submodulePath),
            releaseTagPrefix: opt(c.releaseTagPrefix),
            versionSource: c.versionSource === 'auto' ? undefined : c.versionSource,
            notApplicableControls: optList(c.notApplicableControls),
          }),
        )
      : undefined,
    environments: p.environments.length
      ? p.environments.map((e) => ({ id: t(e.id), name: t(e.name) }))
      : undefined,
    trackedWorkflows: p.trackedWorkflows.length
      ? p.trackedWorkflows.map((w) =>
          compact({
            id: t(w.id),
            name: t(w.name),
            file: t(w.file),
            critical: w.critical ? true : undefined,
            appliesTo: optList(w.appliesTo),
          }),
        )
      : undefined,
    securityControls: Object.fromEntries(
      CONTROL_IDS.map((id) => [id, { required: p.securityControls[id] }]),
    ),
    securityStatusPath: opt(p.securityStatusPath, DEFAULT_SECURITY_STATUS_PATH),
  });
}

/**
 * Compact catalog object (every project). Discovery settings are not part of it: they live in
 * config/catalog.yaml and are not edited here.
 */
export function toCatalogInput(draft: DraftCatalog): Record<string, unknown> {
  return { projects: draft.projects.map(toProjectInput) };
}

/** Header of the legacy single-file catalog (config/projects.yaml, still accepted). */
export const YAML_HEADER = [
  ' yaml-language-server: $schema=./schema/projects.schema.json',
  '',
  ' Engineering Project Hub — project catalog (legacy single file, every project).',
  ' Generated with the catalog editor of the portal; review it before committing.',
  ' Use it INSTEAD of config/projects/*.yaml (the same id in both is a duplicate);',
  ' discovery settings stay in config/catalog.yaml.',
  ' Validate with: npm run validate:config',
  ' Reference: docs/configuration.md (EN) · docs/it/configuration.md (IT)',
].join('\n');

/** Header of a per-project file, like the hand-written files in config/projects/. */
export function projectYamlHeader(id: string): string {
  return [
    ' yaml-language-server: $schema=../schema/project.schema.json',
    '',
    ` Engineering Project Hub — project "${id.replace(/[\r\n]+/g, ' ')}".`,
    ' One file per project (file name = id), generated with the catalog editor of the portal;',
    ' review it before committing. Validate with: npm run validate:config',
    ' Reference: docs/configuration.md (EN) · docs/it/configuration.md (IT)',
  ].join('\n');
}

const SPACED_KEYS = new Set([
  'coordinator',
  'components',
  'environments',
  'trackedWorkflows',
  'securityControls',
]);

/** Flow style for environments and control requirements, a blank line before sections. */
function styleProject(item: YAMLMap) {
  for (const pair of item.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : '';
    if (SPACED_KEYS.has(key) && isScalar(pair.key)) pair.key.spaceBefore = true;
    if (key === 'environments' && isSeq(pair.value))
      pair.value.items.forEach((e) => isMap(e) && (e.flow = true));
    if (key === 'securityControls' && isMap(pair.value))
      (pair.value as YAMLMap).items.forEach((c) => isMap(c.value) && (c.value.flow = true));
  }
}

function render(doc: Document): string {
  visit(doc, {
    Seq(_, node) {
      if (node.items.length > 0 && node.items.every((i) => isScalar(i))) node.flow = true;
    },
  });
  // Prettier style: "{ id: dev }" but "[a, b]" (only for unquoted scalar lists).
  return doc.toString({ lineWidth: 0 }).replace(/^(\s*[A-Za-z]+: )\[ ([^"'\n]*) \]$/gm, '$1[$2]');
}

/**
 * YAML of one project file (config/projects/<id>.yaml): a single ProjectConfig document,
 * formatted like the hand-written files.
 */
export function projectToYaml(project: DraftProject): string {
  const doc = new Document(toProjectInput(project));
  doc.commentBefore = projectYamlHeader(project.id.trim());
  if (isMap(doc.contents)) styleProject(doc.contents);
  return render(doc);
}

/**
 * YAML of the whole catalog in the legacy single-file layout (config/projects.yaml), with a
 * blank line between projects and sections.
 */
export function catalogToYaml(draft: DraftCatalog): string {
  const doc = new Document(toCatalogInput(draft));
  doc.commentBefore = YAML_HEADER;
  const projects = doc.get('projects', true);
  if (isSeq(projects)) {
    projects.items.forEach((item, i) => {
      if (!isMap(item)) return;
      if (i > 0) item.spaceBefore = true;
      styleProject(item);
    });
  }
  return render(doc);
}

/** Lowercase slug accepted by the catalog (a-z, 0-9, "-", at most 63 chars). */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

/** Component id for a submodule path: last segment, then full path, then a numeric suffix. */
export function slugFromSubmodulePath(path: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  used.add('coordinator');
  const segments = path.split('/').filter(Boolean);
  const candidates = [slugify(segments.at(-1) ?? ''), slugify(segments.join('-'))].filter(Boolean);
  if (!candidates.length) candidates.push('component');
  for (const c of candidates) if (!used.has(c)) return c;
  const base = candidates[0]!;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const c = `${base.slice(0, 63 - suffix.length)}${suffix}`;
    if (!used.has(c)) return c;
  }
}

export function emptyComponent(id = ''): DraftComponent {
  return {
    id,
    name: '',
    repository: '',
    path: '',
    type: 'service',
    defaultBranch: '',
    submodulePath: '',
    releaseTagPrefix: '',
    versionSource: 'auto',
    notApplicableControls: [],
  };
}
export const emptyEnvironment = (): DraftEnvironment => ({ id: '', name: '' });
export const emptyWorkflow = (): DraftWorkflow => ({
  id: '',
  name: '',
  file: '',
  critical: false,
  appliesTo: [],
});

export function emptyProject(taken: Iterable<string> = []): DraftProject {
  const used = new Set(taken);
  let id = 'new-project';
  for (let n = 2; used.has(id); n++) id = `new-project-${n}`;
  return {
    id,
    name: '',
    description: '',
    businessUnit: '',
    lifecycle: 'development',
    coordinator: { repository: '', defaultBranch: '', manifestPath: '', notApplicableControls: [] },
    // A new project starts as a single repository; components are optional.
    components: [],
    environments: [],
    trackedWorkflows: [],
    securityControls: Object.fromEntries(
      CONTROL_IDS.map((c) => [c, ['codeScanning', 'secretScanning', 'dependabot'].includes(c)]),
    ) as Record<ControlId, boolean>,
    securityStatusPath: '',
  };
}

/** True when a component of the project already points at this submodule path. */
export const isSubmoduleMapped = (project: DraftProject, path: string) =>
  project.components.some((c) => c.submodulePath.trim() === path);

/**
 * Appends a component for an unmapped submodule. It is linked by its configured path
 * (submodulePath); the repository is prefilled when the collector could reduce the remote.
 */
export function addSuggestedComponent(
  project: DraftProject,
  submodule: UnmappedSubmodule,
): DraftComponent {
  const id = slugFromSubmodulePath(
    submodule.path,
    project.components.map((c) => c.id),
  );
  const component: DraftComponent = {
    ...emptyComponent(id),
    name: submodule.path.split('/').filter(Boolean).at(-1) ?? id,
    repository: submodule.repository ?? '',
    submodulePath: submodule.path,
  };
  project.components.push(component);
  return component;
}

/** Keeps workflow appliesTo references in sync when a component id is edited. */
export function renameComponentId(project: DraftProject, from: string, to: string): void {
  if (from === to) return;
  for (const w of project.trackedWorkflows)
    w.appliesTo = w.appliesTo.map((target) => (target === from ? to : target));
}

export type IssuePath = readonly PropertyKey[];

/** projects[1].components[0].repository — same notation as the collector's formatIssues. */
export function formatIssuePath(path: IssuePath): string {
  const s = path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
    .join('');
  return s || '(root)';
}

export interface EditorIssue {
  path: (string | number)[];
  /** Field key used by the editor: path joined with "." (e.g. projects.1.components.0.id). */
  key: string;
  message: string;
  /** "projects[1].components[0].repository: must be "owner/name"" */
  text: string;
}

export function formatIssues(error: z.ZodError): EditorIssue[] {
  return error.issues.map((issue) => {
    const path = issue.path.filter(
      (p): p is string | number => typeof p === 'string' || typeof p === 'number',
    );
    return {
      path,
      key: path.join('.'),
      message: issue.message,
      text: `${formatIssuePath(issue.path)}: ${issue.message}`,
    };
  });
}

export function validateDraft(draft: DraftCatalog): EditorIssue[] {
  const result = CatalogSchema.safeParse(toCatalogInput(draft));
  return result.success ? [] : formatIssues(result.error);
}

/** "owner/repo" from a package.json repository URL on GitHub, else null. */
export function githubRepoFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  const m = /github\.com[/:]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/* ---------- Saving: one file per project, proposed through the GitHub web editor ---------- */

export const PROJECTS_DIR = 'config/projects';
export const DEFAULT_BRANCH = 'main';
/** Beyond this length the prefilled new-file URL is not used (browser / GitHub limits). */
export const MAX_GITHUB_URL_LENGTH = 7000;

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const REPO_SLUG = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

export const isProjectId = (id: string) => SLUG.test(id);
export const projectFilePath = (id: string) => `${PROJECTS_DIR}/${id}.yaml`;

function repoBase(repo: string, action: 'new' | 'edit' | 'delete'): string | null {
  if (!REPO_SLUG.test(repo)) return null;
  const [owner, name] = repo.split('/') as [string, string];
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${action}/${DEFAULT_BRANCH}`;
}

export interface NewFileUrl {
  url: string;
  /** False when the YAML did not fit in the URL: copy it and paste it on the page. */
  prefilled: boolean;
}

/**
 * GitHub "create new file" page for config/projects/<id>.yaml, prefilled with the YAML
 * (GitHub then offers "Create a new branch and start a pull request"). Null when the
 * repository or the id is not valid.
 */
export function githubNewFileUrl(repo: string, id: string, yaml: string): NewFileUrl | null {
  const base = repoBase(repo, 'new');
  if (!base || !isProjectId(id)) return null;
  const withoutValue = `${base}?filename=${PROJECTS_DIR}/${encodeURIComponent(id)}.yaml`;
  const url = `${withoutValue}&value=${encodeURIComponent(yaml)}`;
  return url.length <= MAX_GITHUB_URL_LENGTH
    ? { url, prefilled: true }
    : { url: withoutValue, prefilled: false };
}

/** GitHub web editor of an existing project file. */
export function githubEditFileUrl(repo: string, id: string): string | null {
  const base = repoBase(repo, 'edit');
  return base && isProjectId(id) ? `${base}/${PROJECTS_DIR}/${encodeURIComponent(id)}.yaml` : null;
}

/** GitHub "delete file" page of a removed project. */
export function githubDeleteFileUrl(repo: string, id: string): string | null {
  const base = repoBase(repo, 'delete');
  return base && isProjectId(id) ? `${base}/${PROJECTS_DIR}/${encodeURIComponent(id)}.yaml` : null;
}

export type ChangeKind = 'new' | 'modified' | 'removed';
export interface PendingChange {
  kind: ChangeKind;
  /** Trimmed project id = file name. */
  id: string;
  name: string;
  /** Index in the draft (null for a removed project). */
  index: number | null;
}

const same = (a: DraftProject, b: DraftProject) =>
  JSON.stringify(toProjectInput(a)) === JSON.stringify(toProjectInput(b));

/**
 * Projects whose file differs from the published catalog, by id (= file name): new ids,
 * modified documents and removed ids. A renamed project is a new file plus a removed one.
 */
export function pendingChanges(published: DraftCatalog, draft: DraftCatalog): PendingChange[] {
  const base = new Map<string, DraftProject>();
  for (const p of published.projects) if (!base.has(p.id.trim())) base.set(p.id.trim(), p);
  const changes: PendingChange[] = [];
  const kept = new Set<string>();
  draft.projects.forEach((p, index) => {
    const id = p.id.trim();
    const name = p.name.trim() || id;
    const before = base.get(id);
    if (!before || kept.has(id)) changes.push({ kind: 'new', id, name, index });
    else if (!same(before, p)) changes.push({ kind: 'modified', id, name, index });
    kept.add(id);
  });
  for (const [id, p] of base)
    if (!kept.has(id))
      changes.push({ kind: 'removed', id, name: p.name.trim() || id, index: null });
  return changes;
}

/* ---------- Project type and discovery proposals ---------- */

export type ProjectKind = 'multi' | 'monorepo' | 'single';

/** Single repository (no components), monorepo (every component in the coordinator's repository) or multi-repository. */
export function projectKind(p: DraftProject): ProjectKind {
  if (!p.components.length) return 'single';
  const coordinator = p.coordinator.repository.trim().toLowerCase();
  return p.components.every((c) => c.repository.trim().toLowerCase() === coordinator)
    ? 'monorepo'
    : 'multi';
}

/** First id not in `taken`: the base itself, then base-2, base-3… (at most 63 chars). */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const start = slugify(base) || 'item';
  if (!used.has(start)) return start;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const id = `${start.slice(0, 63 - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!used.has(id)) return id;
  }
}

/**
 * Adds a discovered project to the draft (nothing is saved): the proposal's configuration as
 * an editable project, with a unique id.
 */
export function importProposal(draft: DraftCatalog, proposal: ProjectConfig): DraftProject {
  const project = projectToDraft(proposal);
  project.id = uniqueId(
    proposal.id,
    draft.projects.map((p) => p.id.trim()),
  );
  draft.projects.push(project);
  return project;
}

/** Draft project that already uses this repository as coordinator (case-insensitive). */
export function findProjectByCoordinator(
  draft: DraftCatalog,
  repository: string,
): DraftProject | undefined {
  const repo = repository.toLowerCase();
  return draft.projects.find((p) => p.coordinator.repository.trim().toLowerCase() === repo);
}

const location = (repository: string, path: string | undefined) =>
  `${repository.trim().toLowerCase()}:${(path ?? '').trim()}`;

export interface MissingItems {
  components: ComponentConfig[];
  workflows: TrackedWorkflowConfig[];
}

/**
 * Components (by repository + path, or submodule path) and tracked workflows (by file) of a
 * proposal that the project does not have yet.
 */
export function missingFromProposal(project: DraftProject, proposal: ProjectConfig): MissingItems {
  const locations = new Set(project.components.map((c) => location(c.repository, c.path)));
  const submodules = new Set(project.components.map((c) => c.submodulePath.trim()).filter(Boolean));
  const files = new Set(project.trackedWorkflows.map((w) => w.file.trim()));
  return {
    components: proposal.components.filter(
      (c) =>
        !locations.has(location(c.repository, c.path)) &&
        !(c.submodulePath && submodules.has(c.submodulePath)),
    ),
    workflows: proposal.trackedWorkflows.filter((w) => !files.has(w.file)),
  };
}

/** Appends a proposed component, renaming its id if already used. */
export function mergeComponent(project: DraftProject, component: ComponentConfig): DraftComponent {
  const c = componentToDraft(component);
  c.id = uniqueId(c.id, ['coordinator', ...project.components.map((x) => x.id.trim())]);
  project.components.push(c);
  return c;
}

/** Appends a proposed tracked workflow, renaming its id if already used. */
export function mergeWorkflow(
  project: DraftProject,
  workflow: TrackedWorkflowConfig,
): DraftWorkflow {
  const w = workflowToDraft(workflow);
  w.id = uniqueId(
    w.id,
    project.trackedWorkflows.map((x) => x.id.trim()),
  );
  project.trackedWorkflows.push(w);
  return w;
}

/** Only https://github.com/… links are rendered for discovered repositories. */
export function safeGithubUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'github.com' ? u.href : null;
  } catch {
    return null;
  }
}

/** JSON for a non-executable <script type="application/json"> block, safe against </script>. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/** Replaces {name} placeholders (client-side twin of the i18n format helper). */
export function fill(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) =>
    params[k] === undefined ? m : String(params[k]),
  );
}
