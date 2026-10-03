import { parse as parseYaml } from 'yaml';
import {
  ReleaseManifestSchema,
  type ComponentSnapshot,
  type EnvironmentSnapshot,
  type ProjectConfig,
  type ProjectSnapshot,
  type ReleaseInfo,
  type ReleaseManifest,
  type Submodule,
} from '@model/index';
import type { RawProjectData } from '../collectors/collect';
import { scrubIdentifier } from '../sanitizers/sanitize';
import { githubRepositoryFromUrl } from '../util/gitmodules';
import { compareVersions, normaliseVersion } from '../util/semver';
import {
  pushError,
  recordError,
  toReleaseInfo,
  toRepositoryInfo,
  type BuildContext,
} from './model';

export type ManifestState = ProjectSnapshot['coordinator']['manifest']['status'];

export function parseManifest(
  ctx: BuildContext,
  raw: RawProjectData,
): { state: ManifestState; manifest: ReleaseManifest | null } {
  const r = raw.manifest;
  const repo = raw.config.coordinator.repository;
  if (!r.ok) {
    const c = r.error.classification;
    recordError(ctx, repo, 'coordinator', 'manifest', r, { expectedNotFound: true });
    return {
      state: c === 'not-found' ? 'missing' : c === 'not-authorised' ? 'not-authorised' : 'unknown',
      manifest: null,
    };
  }
  let doc: unknown;
  try {
    doc = parseYaml(r.data.text);
  } catch {
    pushError(ctx, repo, 'coordinator', 'manifest', {
      classification: 'invalid-data',
      message: 'release manifest is not valid YAML',
    });
    return { state: 'invalid', manifest: null };
  }
  const parsed = ReleaseManifestSchema.safeParse(doc);
  if (!parsed.success) {
    pushError(ctx, repo, 'coordinator', 'manifest', {
      classification: 'invalid-data',
      message: `release manifest does not match contract 1.0 (${parsed.error.issues.length} issue(s))`,
    });
    return { state: 'invalid', manifest: null };
  }
  return { state: 'ok', manifest: parsed.data };
}

/** Associates .gitmodules entries with components: configured path first, then remote URL. */
export function resolveSubmodules(ctx: BuildContext, raw: RawProjectData): Submodule[] {
  const { config } = raw;
  const coordRepo = config.coordinator.repository;
  if (!raw.gitmodules.ok) {
    const c = raw.gitmodules.error.classification;
    recordError(ctx, coordRepo, 'coordinator', 'gitmodules', raw.gitmodules, {
      expectedNotFound: true,
    });
    // Components declaring a submodule cannot be resolved; status depends on why.
    return config.components
      .filter((c) => c.submodulePath)
      .map((comp) => ({
        path: comp.submodulePath!,
        repository: comp.repository.toLowerCase(),
        sha: null,
        componentId: comp.id,
        association: 'configured-path' as const,
        status: c === 'not-found' ? ('unresolvable' as const) : ('unknown' as const),
      }));
  }
  const result: Submodule[] = raw.submodules.map((entry) => {
    const remote = githubRepositoryFromUrl(entry.url, coordRepo);
    const byPath = config.components.find((c) => c.submodulePath === entry.path);
    const byUrl = byPath
      ? undefined
      : config.components.find((c) => remote && c.repository.toLowerCase() === remote);
    const component = byPath ?? byUrl;
    const ref = raw.submoduleRefs.get(entry.path);
    let status: Submodule['status'] = 'unknown';
    if (ref?.ok) status = 'resolved';
    else if (ref && !ref.ok) {
      status = ref.error.classification === 'not-found' ? 'unresolvable' : 'unknown';
      recordError(ctx, coordRepo, 'coordinator', 'submodule', ref);
    }
    return {
      path: scrubIdentifier(entry.path, 255) ?? 'unknown',
      repository: remote,
      sha: ref?.ok ? ref.data.sha : null,
      componentId: component?.id ?? null,
      association: byPath ? 'configured-path' : byUrl ? 'repository-url' : 'unmapped',
      status,
    };
  });
  for (const comp of config.components) {
    if (comp.submodulePath && !result.some((s) => s.componentId === comp.id)) {
      result.push({
        path: comp.submodulePath,
        repository: comp.repository.toLowerCase(),
        sha: null,
        componentId: comp.id,
        association: 'configured-path',
        status: 'unresolvable',
      });
    }
  }
  return result;
}

export function coordinatorVersion(
  manifest: ReleaseManifest | null,
  release: ReleaseInfo | null,
): { version: string | null; source: ProjectSnapshot['coordinator']['versionSource'] } {
  if (manifest)
    return { version: normaliseVersion(scrubIdentifier(manifest.version)), source: 'manifest' };
  if (release)
    return {
      version: normaliseVersion(release.tag),
      source: release.kind === 'release' ? 'release' : 'tag',
    };
  return { version: null, source: 'unknown' };
}

export function toComponents(
  ctx: BuildContext,
  raw: RawProjectData,
  manifest: ReleaseManifest | null,
  submodules: Submodule[],
): ComponentSnapshot[] {
  return raw.config.components.map((comp) => {
    const data = raw.repos.find((r) => r.componentId === comp.id)!;
    const latestRelease = data.repo.ok
      ? toReleaseInfo(ctx, comp.repository, data.release, data.tag)
      : null;
    const declared = normaliseVersion(scrubIdentifier(manifest?.components[comp.id]?.version));
    const latest = normaliseVersion(latestRelease?.tag, comp.releaseTagPrefix);
    let drift: ComponentSnapshot['drift'] = 'unknown';
    if (declared && latest) drift = compareVersions(declared, latest) === 0 ? 'aligned' : 'drift';
    return {
      id: comp.id,
      name: comp.name,
      type: comp.type,
      repository: toRepositoryInfo(ctx, data),
      declaredVersion: declared,
      latestRelease,
      submodule: submodules.find((s) => s.componentId === comp.id) ?? null,
      drift,
    };
  });
}

export function toEnvironments(
  config: ProjectConfig,
  manifest: ReleaseManifest | null,
  coordinator: string | null,
): EnvironmentSnapshot[] {
  return config.environments.map((env) => {
    const version = normaliseVersion(scrubIdentifier(manifest?.environments[env.id]?.version));
    let status: EnvironmentSnapshot['status'] = 'unknown';
    if (version && coordinator) {
      const cmp = compareVersions(version, coordinator);
      status = cmp === 0 ? 'aligned' : cmp === -1 ? 'behind' : 'mismatch';
    }
    return {
      id: env.id,
      name: env.name,
      version,
      source: version ? 'manifest' : 'unknown',
      status,
    };
  });
}

export function unknownManifestComponents(
  config: ProjectConfig,
  manifest: ReleaseManifest | null,
): string[] {
  if (!manifest) return [];
  const ids = new Set(config.components.map((c) => c.id));
  return Object.keys(manifest.components)
    .filter((id) => !ids.has(id))
    .map((id) => scrubIdentifier(id, 64) ?? 'unknown');
}
