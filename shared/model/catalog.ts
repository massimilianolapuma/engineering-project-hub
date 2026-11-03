import { z } from 'zod';
import {
  ComponentTypeSchema,
  ControlIdSchema,
  LifecycleSchema,
  RepositoryCheckIdSchema,
  type ControlId,
} from './enums';
import { ociRepository } from './contracts';
import { TeamRefSchema, TeamsConfigSchema, teamSlug } from './teams';

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

/** SonarQube project key (published with the catalog: a name, never a host or a token). */
const sonarProjectKey = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{1,400}$/, 'must be a SonarQube project key');

/** Harbor project and Argo CD names. */
const harborProject = z
  .string()
  .max(255)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'must be a Harbor project name');
const k8sName = z
  .string()
  .max(253)
  .regex(/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/, 'must be a lowercase DNS label');

/** A Harbor image of a component. The reference is the version rendered with `tagTemplate`. */
export const ContainerImageSchema = z
  .object({
    project: harborProject,
    repository: ociRepository,
    /** Must contain "{version}" once; other characters are limited to tag characters. */
    tagTemplate: z
      .string()
      .max(100)
      .regex(/^[A-Za-z0-9._-]*\{version\}[A-Za-z0-9._-]*$/, 'must contain "{version}" once')
      .default('{version}'),
  })
  .strict();
export type ContainerImage = z.infer<typeof ContainerImageSchema>;

const containerImages = z.array(ContainerImageSchema).max(5);

export const ArgocdApplicationSchema = z
  .object({ name: k8sName, namespace: k8sName.optional(), project: k8sName.optional() })
  .strict();
export type ArgocdApplication = z.infer<typeof ArgocdApplicationSchema>;

/** Overrides whether test coverage applies (default by component type, see quality normaliser). */
export const TestCoverageSchema = z.enum(['required', 'not-applicable']);
export type TestCoverage = z.infer<typeof TestCoverageSchema>;

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
    /** Repository checks that make no sense for the coordinator's repository. */
    notApplicableChecks: z.array(RepositoryCheckIdSchema).default([]),
    /** Test coverage applies to the coordinator like a service unless overridden. */
    testCoverage: TestCoverageSchema.optional(),
    /** SonarQube project of the repository (read only when SonarQube is enabled). */
    sonarProjectKey: sonarProjectKey.optional(),
    sonarBranch: branch.optional(),
    /** Harbor images scanned and signed for this repository (max 5). */
    containerImages: containerImages.optional(),
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
    /** Repository checks that make no sense for this component (monorepo: every target must list it). */
    notApplicableChecks: z.array(RepositoryCheckIdSchema).default([]),
    /**
     * Where the component's current version comes from:
     * - auto: submodule (tag resolved from the SHA pinned by the coordinator) → manifest → latest release
     * - submodule: only the tag resolved from the submodule SHA (verified)
     * - manifest: only the version declared in the coordinator's release manifest
     * - release: the component's latest release
     */
    versionSource: VersionSourceSchema.default('auto'),
    /** Overrides the default applicability of test coverage for this component type. */
    testCoverage: TestCoverageSchema.optional(),
    sonarProjectKey: sonarProjectKey.optional(),
    sonarBranch: branch.optional(),
    containerImages: containerImages.optional(),
  })
  .strict();
export type ComponentConfig = z.infer<typeof ComponentConfigSchema>;

export const EnvironmentConfigSchema = z
  .object({
    id: slug,
    name: z.string().min(1).max(50),
    /** Argo CD application that deploys this environment (read only when Argo CD is enabled). */
    argocdApplication: ArgocdApplicationSchema.optional(),
  })
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
    /** GitHub teams working on the project ("<org>/<team-slug>"): a view filter, not access control. */
    teams: z.array(TeamRefSchema).max(50).default([]),
  })
  .strict()
  .superRefine((p, ctx) => {
    const dup = (values: string[]) => values.filter((v, i) => values.indexOf(v) !== i);
    const teams = p.teams.map((t) => t.toLowerCase());
    teams.forEach((t, i) => {
      if (teams.indexOf(t) !== i) {
        ctx.addIssue({
          code: 'custom',
          path: ['teams', i],
          message: `duplicate team "${p.teams[i]}"`,
        });
      }
    });
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
    const images = [
      { path: ['coordinator'], list: p.coordinator.containerImages },
      ...p.components.map((c, i) => ({ path: ['components', i], list: c.containerImages })),
    ].flatMap(({ path, list }) =>
      (list ?? []).map((image, j) => ({
        path: [...path, 'containerImages', j],
        key: `${image.project}/${image.repository}`,
      })),
    );
    images.forEach((image, i) => {
      if (images.findIndex((other) => other.key === image.key) !== i) {
        ctx.addIssue({
          code: 'custom',
          path: image.path,
          message: `duplicate container image "${image.key}"`,
        });
      }
    });
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
const hintKey = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,49}$/, 'must be a property key');
const hintPrefix = z.string().regex(/^[a-z0-9-]{1,30}$/, 'must be a topic prefix');
/** Which custom properties / topics carry the project, component and type hints. */
export const DiscoveryHintsSchema = z
  .object({
    projectProperty: hintKey.default('hub-project'),
    componentProperty: hintKey.default('hub-component'),
    typeProperty: hintKey.default('hub-component-type'),
    projectTopicPrefix: hintPrefix.default('project-'),
    typeTopicPrefix: hintPrefix.default('type-'),
  })
  .strict();
export type DiscoveryHints = z.infer<typeof DiscoveryHintsSchema>;

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
    /** Read repository topics as project / type hints (already part of the repository list). */
    topics: z.boolean().default(false),
    /** Read custom property values (one call per scanned repository); only `hints` keys are kept. */
    customProperties: z.boolean().default(false),
    hints: DiscoveryHintsSchema.prefault({}),
  })
  .strict();
export type DiscoveryConfig = z.infer<typeof DiscoveryConfigSchema>;

/** config/catalog.yaml: catalog-wide settings (projects live in config/projects/*.yaml). */
export const CatalogSettingsSchema = z
  .object({ discovery: DiscoveryConfigSchema.optional(), teams: TeamsConfigSchema.optional() })
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
      hints: {
        projectProperty: 'hub-project',
        componentProperty: 'hub-component',
        typeProperty: 'hub-component-type',
        projectTopicPrefix: 'project-',
        typeTopicPrefix: 'type-',
      },
    }),
    teams: TeamsConfigSchema.default({ discovery: false, maxTeams: 300 }),
    /** May be empty when discovery is used to bootstrap the catalog. */
    projects: z.array(ProjectConfigSchema).default([]),
  })
  .strict()
  .superRefine((c, ctx) => {
    // `?team=` links carry the slug only, so one slug must not name teams in two orgs.
    const orgOf = new Map<string, string>();
    c.projects.forEach((p, i) =>
      p.teams.forEach((ref, j) => {
        const slug = teamSlug(ref);
        const org = ref.slice(0, ref.indexOf('/')).toLowerCase();
        const seen = orgOf.get(slug);
        if (seen === undefined) orgOf.set(slug, org);
        else if (seen !== org) {
          ctx.addIssue({
            code: 'custom',
            path: ['projects', i, 'teams', j],
            message: `same team slug "${slug}" in ${seen} and ${org}: team links use the slug only`,
          });
        }
      }),
    );
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
