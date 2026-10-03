import { z } from 'zod';
import { ComponentTypeSchema, ControlIdSchema, LifecycleSchema, type ControlId } from './enums';

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
    type: ComponentTypeSchema,
    defaultBranch: branch.optional(),
    /** Path of the Git submodule in the coordinator repository, when the component is one. */
    submodulePath: relativePath.optional(),
    /** Prefix stripped from release tags before version comparison (e.g. "backend-v"). */
    releaseTagPrefix: z.string().max(50).optional(),
    /** Controls that make no sense for this component (e.g. container scanning on a Helm repo). */
    notApplicableControls: z.array(ControlIdSchema).default([]),
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
    components: z.array(ComponentConfigSchema).min(1),
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

export const CatalogSchema = z
  .object({
    /**
     * Reserved for future discovery through repository topics / custom properties.
     * Accepted but not used by the MVP collector.
     */
    discovery: z
      .object({ topics: z.boolean().default(false), customProperties: z.boolean().default(false) })
      .strict()
      .default({ topics: false, customProperties: false }),
    projects: z.array(ProjectConfigSchema).min(1),
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

/** Every repository a project touches, coordinator first. */
export function projectTargets(
  project: ProjectConfig,
): { componentId: string; repository: string }[] {
  return [
    { componentId: 'coordinator', repository: project.coordinator.repository },
    ...project.components.map((c) => ({ componentId: c.id, repository: c.repository })),
  ];
}

export function requiredControls(project: ProjectConfig): ControlId[] {
  return (Object.keys(project.securityControls) as ControlId[]).filter(
    (id) => project.securityControls[id].required,
  );
}
