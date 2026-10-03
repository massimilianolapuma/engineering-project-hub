import { Document, isMap, isScalar, isSeq, visit, type YAMLMap } from 'yaml';
import type { z } from 'zod';
import { CatalogSchema, type Catalog, type VersionSource } from '@model/catalog';
import { CONTROL_IDS, type ControlId } from '@model/enums';

/*
 * Pure logic of the catalog editor (no DOM): editable draft model, conversion to the compact
 * catalog object written to config/projects.yaml, YAML generation and validation with the real
 * CatalogSchema. Shared by the browser script (src/scripts/catalog-editor.ts) and unit tests.
 */

export const DEFAULT_MANIFEST_PATH = 'release-manifest.yaml';
export const DEFAULT_SECURITY_STATUS_PATH = '.security/project-security-status.json';

export interface DraftComponent {
  id: string;
  name: string;
  repository: string;
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
  discovery: { topics: boolean; customProperties: boolean };
  projects: DraftProject[];
}
export interface UnmappedSubmodule {
  path: string;
  repository: string | null;
}

const orEmpty = (v: string | undefined, dflt?: string) => (v === undefined || v === dflt ? '' : v);

/** Editable draft from the parsed (defaults applied) catalog published by the collector. */
export function toDraft(catalog: Catalog): DraftCatalog {
  return {
    discovery: { ...catalog.discovery },
    projects: catalog.projects.map((p) => ({
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
      components: p.components.map((c) => ({
        id: c.id,
        name: c.name,
        repository: c.repository,
        type: c.type,
        defaultBranch: orEmpty(c.defaultBranch),
        submodulePath: orEmpty(c.submodulePath),
        releaseTagPrefix: orEmpty(c.releaseTagPrefix),
        versionSource: c.versionSource,
        notApplicableControls: [...c.notApplicableControls],
      })),
      environments: p.environments.map((e) => ({ ...e })),
      trackedWorkflows: p.trackedWorkflows.map((w) => ({
        id: w.id,
        name: w.name,
        file: w.file,
        critical: w.critical,
        appliesTo: [...(w.appliesTo ?? [])],
      })),
      securityControls: Object.fromEntries(
        CONTROL_IDS.map((id) => [id, p.securityControls[id].required]),
      ) as Record<ControlId, boolean>,
      securityStatusPath: orEmpty(p.securityStatusPath, DEFAULT_SECURITY_STATUS_PATH),
    })),
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
 * Compact catalog object as written to config/projects.yaml: required fields always present
 * (so validation reports them by name), optional fields omitted when empty or default.
 * Array rows are never dropped, so issue paths match the editor rows.
 */
export function toCatalogInput(draft: DraftCatalog): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (draft.discovery.topics || draft.discovery.customProperties)
    out.discovery = { ...draft.discovery };
  out.projects = draft.projects.map((p) =>
    compact({
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
      components: p.components.map((c) =>
        compact({
          id: t(c.id),
          name: t(c.name),
          repository: t(c.repository),
          type: c.type,
          defaultBranch: opt(c.defaultBranch),
          submodulePath: opt(c.submodulePath),
          releaseTagPrefix: opt(c.releaseTagPrefix),
          versionSource: c.versionSource === 'auto' ? undefined : c.versionSource,
          notApplicableControls: optList(c.notApplicableControls),
        }),
      ),
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
    }),
  );
  return out;
}

export const YAML_HEADER = [
  ' yaml-language-server: $schema=./schema/projects.schema.json',
  '',
  ' Engineering Project Hub — project catalog.',
  ' Generated with the catalog editor of the portal; review it before committing.',
  ' Validate with: npm run validate:config',
  ' Reference: docs/configuration.md (EN) · docs/it/configuration.md (IT)',
].join('\n');

const SPACED_KEYS = new Set([
  'coordinator',
  'components',
  'environments',
  'trackedWorkflows',
  'securityControls',
]);

/**
 * YAML of the whole catalog, formatted like the hand-written file: flow style for short lists,
 * environments and control requirements, a blank line between projects and sections.
 */
export function catalogToYaml(draft: DraftCatalog): string {
  const doc = new Document(toCatalogInput(draft));
  doc.commentBefore = YAML_HEADER;
  visit(doc, {
    Seq(_, node) {
      if (node.items.length > 0 && node.items.every((i) => isScalar(i))) node.flow = true;
    },
  });
  const projects = doc.get('projects', true);
  if (isSeq(projects)) {
    projects.items.forEach((item, i) => {
      if (!isMap(item)) return;
      if (i > 0) item.spaceBefore = true;
      for (const pair of item.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : '';
        if (SPACED_KEYS.has(key) && isScalar(pair.key)) pair.key.spaceBefore = true;
        if (key === 'environments' && isSeq(pair.value))
          pair.value.items.forEach((e) => isMap(e) && (e.flow = true));
        if (key === 'securityControls' && isMap(pair.value))
          (pair.value as YAMLMap).items.forEach((c) => isMap(c.value) && (c.value.flow = true));
      }
    });
  }
  const discovery = doc.get('discovery', true);
  if (isMap(discovery) && isSeq(projects)) {
    const pPair = (doc.contents as YAMLMap).items.find(
      (p) => isScalar(p.key) && p.key.value === 'projects',
    );
    if (pPair && isScalar(pPair.key)) pPair.key.spaceBefore = true;
  }
  // Prettier style: "{ id: dev }" but "[a, b]" (only for unquoted scalar lists).
  return doc.toString({ lineWidth: 0 }).replace(/^(\s*[A-Za-z]+: )\[ ([^"'\n]*) \]$/gm, '$1[$2]');
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
    components: [emptyComponent()],
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

export function githubEditUrl(repositoryUrl: string | undefined | null): string | null {
  const repo = githubRepoFromUrl(repositoryUrl);
  return repo ? `https://github.com/${repo}/edit/main/config/projects.yaml` : null;
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
