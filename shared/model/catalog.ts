import { z } from 'zod';
import { ComponentTypeSchema, ControlIdSchema, LifecycleSchema, type ControlId } from './enums';

export const VersionSourceSchema = z.enum(['auto', 'submodule', 'manifest', 'release']);
export type VersionSource = z.infer<typeof VersionSourceSchema>;

const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'must be a lowercase slug (a-z, 0-9, "-")');

export const RepositoryRefSchema = z
  .string()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/, 'must be "owner/name"');

const branch = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^\s~^:?*[\\]+$/, 'invalid branch name');

const relativePath = z
  .string()
  .min(1)
  .max(255)
  .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), 'must be a relative path');

const ControlRequirementSchema = z.object({ required: z.boolean() }).strict();

export const SecurityControlsConfigSchema = z
  .object({
    codeScanning: ControlRequirementSchema,
    secretScanning: ControlRequirementSchema,
    dependabot: ControlRequirementSchema,
    containerScanning: ControlRequirementSchema,
    iacScanning: ControlRequirementSchema,
    dast: ControlRequirementSchema,
    sbom: ControlRequirementSchema,
    artifactSignature: ControlRequirementSchema,
  })
  .strict();
export type SecurityControlsConfig = z.infer<typeof SecurityControlsConfigSchema>;

export const CoordinatorConfigSchema = z
  .object({
    repository: RepositoryRefSchema,
    defaultBranch: branch.optional(),
    /** Optional release manifest declaring expected component and environment versions. */
    manifestPath: relativePath.default('release-manifest.yaml'),
    /** Controls that make no sense for the coordinator (e.g. container scanning). */
    notApplicableControls: z.array(ControlIdSchema).default([]),
  })
  .strict();

export const ComponentConfigSchema = z
  .object({
    id: slug.refine((id) => id !== 'coordinator', '"coordinator" is reserved'),
    name: z.string().min(1).max(100),
    repository: RepositoryRefSchema,
    /**
     * Directory of the component inside its repository (monorepos). Required when the
     * component lives in the coordinator's repository.
     */
    path: relativePath.optional(),
    type: ComponentTypeSchema,
    defaultBranch: branch.optional(),
    /** Path of the Git submodule in the coordinator repository, when the component is one. */
    submodulePath: relativePath.optional(),
    /** Prefix stripped from release tags before version comparison (e.g. "backend-v"). */
    releaseTagPrefix: z.string().max(50).optional(),
    /** Controls that make no sense for this component (e.g. container scanning on a Helm repo). */
    notApplicableControls: z.array(ControlIdSchema).default([]),
    /**
     * Where the component's current version comes from:
     * - auto: submodule (tag resolved from the SHA pinned by the coordinator) → manifest → latest release
     * - submodule: only the tag resolved from the submodule SHA (verified)
     * - manifest: only the version declared in the coordinator's release manifest
     * - release: the component's latest release
     */
    versionSource: VersionSourceSchema.default('auto'),
  })
  .strict();
export type ComponentConfig = z.infer<typeof ComponentConfigSchema>;

export const EnvironmentConfigSchema = z
  .object({ id: slug, name: z.string().min(1).max(50) })
  .strict();

export const TrackedWorkflowConfigSchema = z
  .object({
    id: slug,
    name: z.string().min(1).max(100),
    file: z
      .string()
      .regex(/^[A-Za-z0-9._-]+\.ya?ml$/, 'must be a workflow file name (e.g. ci.yml)'),
    critical: z.boolean().default(false),
    /** Component ids (or "coordinator") the workflow is expected in. Defaults to every component. */
    appliesTo: z.array(z.string()).optional(),
  })
  .strict();
export type TrackedWorkflowConfig = z.infer<typeof TrackedWorkflowConfigSchema>;

export const ProjectConfigSchema = z
  .object({
    id: slug,
    name: z.string().min(1).max(100),
    description: z.string().max(500).default(''),
    businessUnit: z.string().min(1).max(100),
    lifecycle: LifecycleSchema,
    coordinator: CoordinatorConfigSchema,
    /** Empty for single-repository projects (the coordinator is the only repository). */
    components: z.array(ComponentConfigSchema).default([]),
    environments: z.array(EnvironmentConfigSchema).default([]),
    trackedWorkflows: z.array(TrackedWorkflowConfigSchema).default([]),
    securityControls: SecurityControlsConfigSchema,
    securityStatusPath: relativePath.default('.security/project-security-status.json'),
  })
  .strict()
  .superRefine((p, ctx) => {
    const dup = (values: string[]) => values.filter((v, i) => values.indexOf(v) !== i);
    for (const id of dup(p.components.map((c) => c.id))) {
      ctx.addIssue({
        code: 'custom',
        path: ['components'],
        message: `duplicate component id "${id}"`,
      });
    }
    for (const id of dup(p.environments.map((e) => e.id))) {
      ctx.addIssue({
        code: 'custom',
        path: ['environments'],
        message: `duplicate environment id "${id}"`,
      });
    }
    for (const id of dup(p.trackedWorkflows.map((w) => w.id))) {
      ctx.addIssue({
        code: 'custom',
        path: ['trackedWorkflows'],
        message: `duplicate workflow id "${id}"`,
      });
    }
    for (const path of dup(
      p.components.flatMap((c) => (c.submodulePath ? [c.submodulePath] : [])),
    )) {
      ctx.addIssue({
        code: 'custom',
        path: ['components'],
        message: `duplicate submodulePath "${path}"`,
      });
    }
    const coordinator = p.coordinator.repository.toLowerCase();
    p.components.forEach((c, i) => {
      if (c.repository.toLowerCase() === coordinator && !c.path) {
        ctx.addIssue({
          code: 'custom',
          path: ['components', i, 'path'],
          message: 'required when the component lives in the coordinator repository (monorepo)',
        });
      }
      if (c.path && c.submodulePath) {
        ctx.addIssue({
          code: 'custom',
          path: ['components', i, 'submodulePath'],
          message: 'a component is either a submodule or a monorepo directory, not both',
        });
      }
    });
    for (const key of dup(
      p.components.map((c) => `${c.repository.toLowerCase()}:${c.path ?? ''}`),
    )) {
      ctx.addIssue({
        code: 'custom',
        path: ['components'],
        message: `duplicate component location "${key}"`,
      });
    }
    const targets = new Set(['coordinator', ...p.components.map((c) => c.id)]);
    p.trackedWorkflows.forEach((w, i) => {
      for (const target of w.appliesTo ?? []) {
        if (!targets.has(target)) {
          ctx.addIssue({
            code: 'custom',
            path: ['trackedWorkflows', i, 'appliesTo'],
            message: `unknown component "${target}" (expected "coordinator" or a component id)`,
          });
        }
      }
    });
  });
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

/**
 * Automatic discovery of repositories. Discovery only produces *proposals* (shown in the
 * catalog editor): nothing enters the portal until a project file is saved.
 */
export const DiscoveryConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Organisations or users whose repositories are scanned. */
    owners: z
      .array(z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, 'must be a GitHub owner'))
      .default([]),
    /** Ignored (forced false) when publication.audience is "public". */
    includePrivate: z.boolean().default(false),
    includeForks: z.boolean().default(false),
    includeArchived: z.boolean().default(false),
    /** Upper bound on scanned repositories per run (API budget). */
    maxRepositories: z.number().int().min(1).max(1000).default(200),
    /** Reserved: discovery through repository topics / custom properties. */
    topics: z.boolean().default(false),
    customProperties: z.boolean().default(false),
  })
  .strict();
export type DiscoveryConfig = z.infer<typeof DiscoveryConfigSchema>;

/** config/catalog.yaml: catalog-wide settings (projects live in config/projects/*.yaml). */
export const CatalogSettingsSchema = z
  .object({ discovery: DiscoveryConfigSchema.optional() })
  .strict();

export const CatalogSchema = z
  .object({
    discovery: DiscoveryConfigSchema.default({
      enabled: false,
      owners: [],
      includePrivate: false,
      includeForks: false,
      includeArchived: false,
      maxRepositories: 200,
      topics: false,
      customProperties: false,
    }),
    /** May be empty when discovery is used to bootstrap the catalog. */
    projects: z.array(ProjectConfigSchema).default([]),
  })
  .strict()
  .superRefine((c, ctx) => {
    const ids = c.projects.map((p) => p.id);
    ids.forEach((id, i) => {
      if (ids.indexOf(id) !== i) {
        ctx.addIssue({
          code: 'custom',
          path: ['projects', i, 'id'],
          message: `duplicate project id "${id}"`,
        });
      }
    });
  });
export type Catalog = z.infer<typeof CatalogSchema>;

/** Every repository a project touches, coordinator first (monorepo components repeat it). */
export function projectTargets(
  project: ProjectConfig,
): { componentId: string; repository: string; path: string | null }[] {
  return [
    { componentId: 'coordinator', repository: project.coordinator.repository, path: null },
    ...project.components.map((c) => ({
      componentId: c.id,
      repository: c.repository,
      path: c.path ?? null,
    })),
  ];
}

/** True when every component lives in the coordinator repository. */
export function isMonorepo(project: ProjectConfig): boolean {
  const coordinator = project.coordinator.repository.toLowerCase();
  return project.components.every((c) => c.repository.toLowerCase() === coordinator);
}

export function requiredControls(project: ProjectConfig): ControlId[] {
  return (Object.keys(project.securityControls) as ControlId[]).filter(
    (id) => project.securityControls[id].required,
  );
}
