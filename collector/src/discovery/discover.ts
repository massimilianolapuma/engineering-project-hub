import { parse as parseYaml } from 'yaml';
import {
  ComponentTypeSchema,
  ProjectConfigSchema,
  type Catalog,
  type ComponentType,
  type DiscoveryConfig,
  type DiscoveryProposal,
  type DiscoveryResult,
  type Policies,
  type ProjectConfig,
} from '@model/index';
import type { CollectContext } from '../collectors/collect';
import type { CustomPropertyDTO, ProviderResult, RepositoryDTO } from '../providers/types';
import { sanitizeUrl, scrubIdentifier, scrubText } from '../sanitizers/sanitize';
import { createLimiter } from '../util/concurrency';
import { githubRepositoryFromUrl, parseGitmodules } from '../util/gitmodules';

/*
 * Repository discovery. Read-only and proposal-only: it scans the configured owners, detects
 * coordinators (.gitmodules), monorepos (workspace manifests) and single repositories, and
 * returns ready-to-edit project configurations. Nothing enters the catalog until a project
 * file is saved through the catalog editor (pull request).
 */

const MAX_COMPONENTS = 30;
/**
 * Workspace manifests come from the scanned repositories (untrusted input): bound how many
 * patterns are expanded (one API call each) so a crafted manifest cannot exhaust the API
 * budget or stall the run.
 */
export const MAX_WORKSPACE_PATTERNS = 10;

/** Unique slug with a numeric suffix ("api", "api-2", "api-3"…), never "coordinator". */
export function uniqueSlug(base: string, used: Set<string>): string {
  const root = slugify(base).slice(0, 58);
  let id = root;
  for (let n = 2; used.has(id) || id === 'coordinator'; n++) id = `${root}-${n}`;
  used.add(id);
  return id;
}
const CRITICAL_WORKFLOW = /^(ci|build|test|release|rel-|cd|deploy)/i;

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || 'project';

const titleCase = (s: string) =>
  s
    .replace(/[-_.]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
    .slice(0, 100);

/** Component type from a monorepo folder ("apps/web" → webapp, "services/api" → service). */
export function guessType(path: string): ComponentType {
  const parts = path.toLowerCase().split('/');
  const byName = (name: string): ComponentType | null => {
    if (/^(apps?|web|frontend|ui|sites?|portal|admin)$/.test(name)) return 'webapp';
    if (/^(services?|api|backend|server|gateway)$/.test(name)) return 'service';
    if (/^(workers?|jobs?|functions?|cron|queue)$/.test(name)) return 'worker';
    if (/^(packages?|libs?|modules?|crates?|shared|common)$/.test(name)) return 'library';
    if (/^(infra|infrastructure|terraform|deploy|charts?|helm)$/.test(name))
      return 'infrastructure';
    return null;
  };
  const top = byName(parts[0] ?? '');
  // Shared-code folders win ("packages/ui" is a library); otherwise the component's own name
  // is the strongest hint ("services/worker" is a worker).
  if (top === 'library' && parts.length > 1) return 'library';
  return byName(parts[parts.length - 1] ?? '') ?? top ?? 'other';
}

/**
 * Workspace patterns declared by common monorepo tools. Only "dir" and "dir/*" patterns are
 * expanded (one level), which covers the vast majority of layouts.
 */
export function workspacePatterns(files: Record<string, string>): {
  patterns: string[];
  evidence: string[];
} {
  const patterns = new Set<string>();
  const evidence: string[] = [];
  const add = (source: string, list: unknown) => {
    const items = (Array.isArray(list) ? list : []).filter(
      (x): x is string => typeof x === 'string',
    );
    if (items.length) evidence.push(`${source}: ${items.slice(0, 5).join(', ')}`);
    items.forEach((x) => patterns.add(x.replace(/^\.\//, '').replace(/\/+$/, '')));
  };
  if (files['package.json']) {
    try {
      const pkg = JSON.parse(files['package.json']) as { workspaces?: unknown };
      const ws = pkg.workspaces;
      add(
        'package.json workspaces',
        Array.isArray(ws) ? ws : (ws as { packages?: unknown })?.packages,
      );
    } catch {
      /* not JSON: ignored */
    }
  }
  if (files['pnpm-workspace.yaml']) {
    try {
      add(
        'pnpm-workspace.yaml',
        (parseYaml(files['pnpm-workspace.yaml']) as { packages?: unknown })?.packages,
      );
    } catch {
      /* ignored */
    }
  }
  if (files['lerna.json']) {
    try {
      add('lerna.json', (JSON.parse(files['lerna.json']) as { packages?: unknown }).packages);
    } catch {
      /* ignored */
    }
  }
  if (files['go.work']) {
    const uses = [...files['go.work'].matchAll(/^\s*(?:use\s+)?(\.\/[^\s()]+)\s*$/gm)].map(
      (m) => m[1]!,
    );
    add('go.work', uses);
  }
  if (files['Cargo.toml']) {
    const ws = /\[workspace\][\s\S]*?members\s*=\s*\[([\s\S]*?)\]/.exec(files['Cargo.toml']);
    if (ws)
      add(
        'Cargo.toml workspace',
        [...ws[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!),
      );
  }
  for (const tool of ['turbo.json', 'nx.json']) {
    if (files[tool] && !patterns.size) add(tool, ['apps/*', 'packages/*', 'services/*', 'libs/*']);
  }
  return {
    patterns: [...patterns].filter((p) => p && !p.startsWith('!') && !p.includes('..')),
    evidence,
  };
}

const HINT_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_HINTS = 10;

export interface RepoHints {
  project: string | null;
  component: string | null;
  type: ComponentType | null;
  evidence: string[];
  hints: DiscoveryProposal['hints'];
}

/**
 * Project, component and type hints of one repository, from custom properties and topics.
 * Pure. Only the three configured property keys are ever read (every other property is
 * dropped here, so it cannot reach the output). Property beats topic; invalid values are
 * ignored with evidence; several project topics are ambiguous.
 */
export function readHints(
  repo: RepositoryDTO,
  properties: CustomPropertyDTO[] | null,
  cfg: DiscoveryConfig,
): RepoHints {
  const h = cfg.hints;
  const evidence: string[] = [];
  const hints: DiscoveryProposal['hints'] = [];
  const keep = new Map<string, CustomPropertyDTO>();
  if (cfg.customProperties)
    for (const prop of properties ?? [])
      if ([h.projectProperty, h.componentProperty, h.typeProperty].includes(prop.name))
        keep.set(prop.name, prop);

  const fromProperty = <T extends string>(
    key: string,
    parse: (v: string) => T | null,
  ): T | null => {
    const prop = keep.get(key);
    if (!prop) return null;
    const parsed = typeof prop.value === 'string' ? parse(prop.value) : null;
    if (parsed === null) {
      evidence.push(`ignored hint ${key}`);
      return null;
    }
    hints.push({ source: 'property', key, value: parsed });
    return parsed;
  };
  const slug = (v: string) => (HINT_SLUG.test(v) ? v : null);
  const type = (v: string) => {
    const r = ComponentTypeSchema.safeParse(v);
    return r.success ? r.data : null;
  };
  const topicValues = (prefix: string) =>
    cfg.topics
      ? repo.topics
          .filter((t) => t.startsWith(prefix) && t.length > prefix.length)
          .map((t) => t.slice(prefix.length))
      : [];
  const fromTopic = <T extends string>(
    prefix: string,
    label: string,
    parse: (v: string) => T | null,
  ): T | null => {
    const candidates = topicValues(prefix);
    if (candidates.length > 1) {
      evidence.push(`ambiguous ${label} topics`);
      return null;
    }
    const parsed = candidates[0] === undefined ? null : parse(candidates[0]);
    if (candidates[0] !== undefined && parsed === null) {
      evidence.push(`ignored hint ${prefix}${candidates[0]}`.slice(0, 120));
      return null;
    }
    if (parsed !== null) hints.push({ source: 'topic', key: `${prefix}*`, value: parsed });
    return parsed;
  };

  const project =
    fromProperty(h.projectProperty, slug) ?? fromTopic(h.projectTopicPrefix, 'project', slug);
  const component = fromProperty(h.componentProperty, slug);
  const resolvedType =
    fromProperty(h.typeProperty, type) ?? fromTopic(h.typeTopicPrefix, 'type', type);
  return {
    project,
    component,
    type: resolvedType,
    evidence,
    hints: hints.slice(0, MAX_HINTS),
  };
}

const WORKSPACE_FILES = [
  'package.json',
  'pnpm-workspace.yaml',
  'lerna.json',
  'go.work',
  'Cargo.toml',
  'turbo.json',
  'nx.json',
];

function baseProject(
  repo: RepositoryDTO,
  kind: DiscoveryProposal['kind'],
): Omit<ProjectConfig, 'components' | 'trackedWorkflows'> {
  return {
    id: slugify(repo.name),
    name: titleCase(repo.name),
    description:
      kind === 'coordinator'
        ? 'Discovered coordinator repository (Git submodules).'
        : kind === 'monorepo'
          ? 'Discovered monorepo (workspace manifest).'
          : 'Discovered single-repository project.',
    businessUnit: scrubIdentifier(repo.owner, 100) ?? 'unknown',
    lifecycle: repo.archived ? 'deprecated' : 'development',
    coordinator: {
      repository: repo.fullName,
      defaultBranch: repo.defaultBranch,
      manifestPath: 'release-manifest.yaml',
      notApplicableControls: [],
      notApplicableChecks: [],
    },
    environments: [],
    securityControls: {
      codeScanning: { required: true },
      secretScanning: { required: true },
      dependabot: { required: true },
      containerScanning: { required: false },
      iacScanning: { required: false },
      dast: { required: false },
      sbom: { required: false },
      artifactSignature: { required: false },
    },
    securityStatusPath: '.security/project-security-status.json',
  };
}

export async function discover(
  ctx: CollectContext,
  catalog: Catalog,
  policies: Policies,
): Promise<DiscoveryResult | null> {
  const cfg = catalog.discovery;
  if (!cfg.enabled) return null;
  const p = ctx.provider;
  // A public site must never list private repositories, whatever the setting says.
  const includePrivate = cfg.includePrivate && policies.publication.audience === 'restricted';
  const errors: DiscoveryResult['errors'] = [];
  const err = (target: string, r: ProviderResult<unknown>) => {
    if (!r.ok)
      errors.push({
        target: scrubIdentifier(target, 200) ?? 'unknown',
        classification: r.error.classification,
      });
  };

  const repos: RepositoryDTO[] = [];
  for (const owner of cfg.owners) {
    const r = await p.listOwnerRepositories(owner, { includePrivate, max: cfg.maxRepositories });
    err(owner, r);
    if (!r.ok) continue;
    repos.push(
      ...r.data.filter(
        (x) =>
          (includePrivate || x.visibility === 'public') &&
          (cfg.includeForks || !x.fork) &&
          (cfg.includeArchived || !x.archived),
      ),
    );
  }
  const scanned = repos.slice(0, cfg.maxRepositories);
  const known = new Map(scanned.map((r) => [r.fullName.toLowerCase(), r]));
  const coordinatorOf = new Map(
    catalog.projects.map((pr) => [pr.coordinator.repository.toLowerCase(), pr.id]),
  );
  const catalogIds = new Set(catalog.projects.map((pr) => pr.id));
  // Every repository already part of a catalog project (coordinator or component), by project.
  const memberOf = new Map<string, Set<string>>();
  for (const pr of catalog.projects)
    memberOf.set(
      pr.id,
      new Set(
        [pr.coordinator.repository, ...pr.components.map((c) => c.repository)].map((x) =>
          x.toLowerCase(),
        ),
      ),
    );
  const limit = createLimiter(4);

  const analysed = await Promise.all(
    scanned.map((repo) =>
      limit(async () => {
        const [gitmodules, workflows] = await Promise.all([
          p.getFile(repo.fullName, '.gitmodules'),
          p.listWorkflows(repo.fullName),
        ]);
        const files: Record<string, string> = {};
        if (!gitmodules.ok) {
          const root = await p.listDirectory(repo.fullName, '');
          if (!root.ok && root.error.classification !== 'not-found') err(repo.fullName, root);
          const present = root.ok
            ? new Set(root.data.filter((e) => e.type === 'file').map((e) => e.name))
            : new Set();
          for (const f of WORKSPACE_FILES.filter((w) => present.has(w))) {
            const r = await p.getFile(repo.fullName, f);
            if (r.ok) files[f] = r.data.text;
          }
        }
        let properties: CustomPropertyDTO[] | null = null;
        if (cfg.customProperties) {
          const r = await p.getCustomPropertyValues(repo.fullName);
          if (r.ok) properties = r.data;
          else if (r.error.classification !== 'not-found') err(repo.fullName, r);
        }
        return { repo, gitmodules, workflows, files, properties };
      }),
    ),
  );

  const proposals: DiscoveryProposal[] = [];
  // Hints of every scanned repository, read up front: a repository claimed as a submodule
  // takes its hinted type and component id into the coordinator's proposal.
  const hintsOf = new Map<string, RepoHints>(
    analysed.map((a) => [a.repo.fullName.toLowerCase(), readHints(a.repo, a.properties, cfg)]),
  );
  const claimed: DiscoveryResult['claimed'] = [];

  for (const a of analysed) {
    const repo = a.repo;
    const trackedWorkflows = (a.workflows.ok ? a.workflows.data : []).slice(0, 20).map((w) => ({
      id: slugify(w.file.replace(/\.ya?ml$/, '')),
      name: scrubText(w.name, 100) ?? w.file,
      file: w.file,
      critical: CRITICAL_WORKFLOW.test(w.file),
      appliesTo: ['coordinator'],
    }));
    let kind: DiscoveryProposal['kind'] = 'single';
    const evidence: string[] = [];
    let components: ProjectConfig['components'] = [];

    if (a.gitmodules.ok) {
      const entries = parseGitmodules(a.gitmodules.data.text);
      kind = 'coordinator';
      evidence.push(`.gitmodules: ${entries.length} submodule(s)`);
      const used = new Set<string>();
      components = entries.slice(0, MAX_COMPONENTS).flatMap((e) => {
        // Only submodules pointing to scanned repositories become components: anything else
        // (private, other owners, non-GitHub) is never published.
        const remote = githubRepositoryFromUrl(e.url, repo.fullName);
        const target = remote ? known.get(remote) : undefined;
        if (!target) return [];
        claimed.push({ repository: target.fullName, by: repo.fullName });
        const targetHints = hintsOf.get(target.fullName.toLowerCase());
        const id = uniqueSlug(targetHints?.component ?? e.path.split('/').pop() ?? e.path, used);
        return [
          {
            id,
            name: titleCase(e.path.split('/').pop() ?? e.path),
            repository: target.fullName,
            type: targetHints?.type ?? guessType(e.path),
            submodulePath: e.path,
            notApplicableControls: [],
            notApplicableChecks: [],
            versionSource: 'auto' as const,
          },
        ];
      });
    } else {
      const ws = workspacePatterns(a.files);
      const dirs = new Set<string>();
      for (const pattern of ws.patterns.slice(0, MAX_WORKSPACE_PATTERNS)) {
        if (dirs.size >= MAX_COMPONENTS) break;
        if (pattern.endsWith('/*')) {
          const parent = pattern.slice(0, -2);
          const listing = await p.listDirectory(repo.fullName, parent);
          if (listing.ok)
            listing.data
              .filter((e) => e.type === 'dir')
              .forEach((e) => dirs.add(`${parent}/${e.name}`));
        } else if (!pattern.includes('*')) dirs.add(pattern);
      }
      if (dirs.size >= 2) {
        kind = 'monorepo';
        evidence.push(...ws.evidence);
        const used = new Set<string>();
        components = [...dirs]
          .sort()
          .slice(0, MAX_COMPONENTS)
          .map((path) => {
            const id = uniqueSlug(path.split('/').pop() ?? path, used);
            return {
              id,
              name: titleCase(path.split('/').pop() ?? path),
              repository: repo.fullName,
              path,
              type: guessType(path),
              releaseTagPrefix: `${id}-v`,
              notApplicableControls: [],
              notApplicableChecks: [],
              versionSource: 'release' as const,
            };
          });
      }
    }
    const hinted = hintsOf.get(repo.fullName.toLowerCase())!;
    if (kind === 'single') evidence.push('no submodules or workspace manifest');
    evidence.push(...hinted.evidence);
    if (trackedWorkflows.length) evidence.push(`${trackedWorkflows.length} workflow(s)`);

    const project = ProjectConfigSchema.safeParse({
      ...baseProject(repo, kind),
      components,
      // Repository-level workflows are tracked on the coordinator (the repository itself).
      trackedWorkflows,
    });
    if (!project.success) {
      errors.push({ target: repo.fullName, classification: 'invalid-data' });
      continue;
    }
    proposals.push({
      kind,
      repository: repo.fullName,
      url: sanitizeUrl(repo.htmlUrl, policies.publication.allowedLinkHosts),
      projectId: coordinatorOf.get(repo.fullName.toLowerCase()) ?? null,
      evidence: evidence.map((e) => scrubText(e, 200) ?? '').filter(Boolean),
      hintedProjectId:
        hinted.project &&
        catalogIds.has(hinted.project) &&
        !memberOf.get(hinted.project)?.has(repo.fullName.toLowerCase())
          ? hinted.project
          : null,
      hints: hinted.hints,
      project: project.data,
    });
  }

  // Repositories already linked as submodules are components, not projects of their own.
  const claimedSet = new Set(claimed.map((c) => c.repository.toLowerCase()));
  const order = { coordinator: 0, monorepo: 1, grouped: 2, single: 3 } as const;
  const open = proposals.filter(
    (x) => x.kind !== 'single' || !claimedSet.has(x.repository.toLowerCase()),
  );
  const grouped = groupByHint(open, hintsOf, catalogIds, coordinatorOf, memberOf);
  return {
    owners: cfg.owners,
    scanned: scanned.length,
    proposals: grouped.sort(
      (a, b) => order[a.kind] - order[b.kind] || a.repository.localeCompare(b.repository),
    ),
    claimed,
    errors,
  };
}

/**
 * Single repositories that share the same hinted project (and are not claimed by a
 * coordinator) become one `grouped` proposal. Their `single` proposals are dropped.
 */
function groupByHint(
  proposals: DiscoveryProposal[],
  hintsOf: Map<string, RepoHints>,
  catalogIds: Set<string>,
  coordinatorOf: Map<string, string>,
  memberOf: Map<string, Set<string>>,
): DiscoveryProposal[] {
  const groups = new Map<string, DiscoveryProposal[]>();
  for (const pr of proposals) {
    const project = hintsOf.get(pr.repository.toLowerCase())?.project;
    if (pr.kind !== 'single' || !project) continue;
    groups.set(project, [...(groups.get(project) ?? []), pr]);
  }
  const merged = new Set<string>();
  const out: DiscoveryProposal[] = [];
  for (const [projectId, members] of groups) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => a.repository.localeCompare(b.repository));
    const hint = (pr: DiscoveryProposal) => hintsOf.get(pr.repository.toLowerCase())!;
    const lead = sorted.find((m) => hint(m).component === 'coordinator') ?? sorted[0]!;
    const used = new Set<string>();
    const components = sorted
      .filter((m) => m !== lead)
      .map((m) => {
        const h = hint(m);
        const name = m.repository.split('/')[1] ?? m.repository;
        return {
          id: uniqueSlug(h.component ?? name, used),
          name: titleCase(name),
          repository: m.repository,
          type: h.type ?? guessType(name),
          notApplicableControls: [],
          notApplicableChecks: [],
          versionSource: 'release' as const,
        };
      });
    const project = ProjectConfigSchema.safeParse({
      ...lead.project,
      id: projectId,
      name: titleCase(projectId),
      description: 'Discovered group of repositories (project hint).',
      components,
    });
    if (!project.success) continue;
    sorted.forEach((m) => merged.add(m.repository));
    const existing = catalogIds.has(projectId);
    out.push({
      kind: 'grouped',
      repository: lead.repository,
      url: lead.url,
      projectId: coordinatorOf.get(lead.repository.toLowerCase()) ?? null,
      evidence: [
        `grouped by project hint "${projectId}": ${sorted.length} repositories`,
        ...lead.evidence,
      ].slice(0, 20),
      hintedProjectId:
        existing && !memberOf.get(projectId)?.has(lead.repository.toLowerCase()) ? projectId : null,
      hints: lead.hints,
      project: project.data,
    });
  }
  return [...proposals.filter((x) => !merged.has(x.repository)), ...out];
}
