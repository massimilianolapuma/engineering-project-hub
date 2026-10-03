import { parse as parseYaml } from 'yaml';
import {
  ReleaseManifestSchema,
  type ComponentSnapshot,
  type Pin,
  type EnvironmentSnapshot,
  type ProjectConfig,
  type ProjectSnapshot,
  type ReleaseInfo,
  type ReleaseManifest,
  type Submodule,
} from '@model/index';
import type { RawProjectData } from '../collectors/collect';
import { associateSubmodules } from './association';
import { scrubIdentifier } from '../sanitizers/sanitize';
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
  const result: Submodule[] = associateSubmodules(config, raw.submodules).map((a) => {
    const ref = raw.submoduleRefs.get(a.entry.path);
    let status: Submodule['status'] = 'unknown';
    if (ref?.ok) status = 'resolved';
    else if (ref && !ref.ok) {
      status = ref.error.classification === 'not-found' ? 'unresolvable' : 'unknown';
      recordError(ctx, coordRepo, 'coordinator', 'submodule', ref);
    }
    return {
      path: scrubIdentifier(a.entry.path, 255) ?? 'unknown',
      repository: a.remote,
      sha: ref?.ok ? ref.data.sha : null,
      componentId: a.component?.id ?? null,
      association: a.association,
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

/** Resolves the SHA pinned by the coordinator into a tag, or a position vs the latest release. */
export function resolvePin(
  raw: RawProjectData,
  comp: ProjectConfig['components'][number],
  submodule: Submodule | null,
): Pin | null {
  if (!submodule) return null;
  const unknown: Pin = {
    status: 'unknown',
    tag: null,
    version: null,
    comparedTo: null,
    aheadBy: null,
    behindBy: null,
  };
  const data = raw.pins.find((p) => p.componentId === comp.id);
  if (!submodule.sha || !data) return unknown;
  if (data.tags.ok) {
    const matches = data.tags.data
      .filter((t) => t.sha === submodule.sha)
      .map((t) => ({
        tag: scrubIdentifier(t.name),
        version: normaliseVersion(scrubIdentifier(t.name), comp.releaseTagPrefix),
      }))
      .filter((t): t is { tag: string; version: string | null } => !!t.tag)
      // Several tags on one commit: prefer the highest semver.
      .sort((a, b) => (b.version && a.version ? (compareVersions(b.version, a.version) ?? 0) : 0));
    if (matches[0])
      return { ...unknown, status: 'tagged', tag: matches[0].tag, version: matches[0].version };
  }
  if (data.compare?.ok) {
    const c = data.compare.data;
    return {
      status: c.status === 'identical' ? 'tagged' : c.status,
      tag: c.status === 'identical' ? scrubIdentifier(data.compareBase) : null,
      version:
        c.status === 'identical'
          ? normaliseVersion(scrubIdentifier(data.compareBase), comp.releaseTagPrefix)
          : null,
      comparedTo: scrubIdentifier(data.compareBase),
      aheadBy: c.aheadBy,
      behindBy: c.behindBy,
    };
  }
  return unknown;
}

export function toComponents(
  ctx: BuildContext,
  raw: RawProjectData,
  manifest: ReleaseManifest | null,
  submodules: Submodule[],
): ComponentSnapshot[] {
  return raw.config.components.map((comp) => {
    const data = raw.repos.find((r) => r.componentId === comp.id)!;
    for (const pin of raw.pins.filter((p) => p.componentId === comp.id)) {
      recordError(ctx, comp.repository, comp.id, 'tag', pin.tags, { expectedNotFound: true });
      recordError(ctx, comp.repository, comp.id, 'tag', pin.compare, { expectedNotFound: true });
    }
    const latestRelease = data.repo.ok
      ? toReleaseInfo(ctx, comp.repository, data.release, data.tag)
      : null;
    const declared = normaliseVersion(scrubIdentifier(manifest?.components[comp.id]?.version));
    const latest = normaliseVersion(latestRelease?.tag, comp.releaseTagPrefix);
    const submodule = submodules.find((s) => s.componentId === comp.id) ?? null;
    const pin = resolvePin(raw, comp, submodule);
    const pinned = pin?.status === 'tagged' ? pin.version : null;

    // Current version according to the configured source (auto: verified pin → manifest).
    let effectiveVersion: string | null = null;
    let effectiveVersionSource: ComponentSnapshot['effectiveVersionSource'] = 'unknown';
    const pick = (v: string | null, src: ComponentSnapshot['effectiveVersionSource']) => {
      if (v && !effectiveVersion) {
        effectiveVersion = v;
        effectiveVersionSource = src;
      }
    };
    switch (comp.versionSource) {
      case 'submodule':
        pick(pinned, 'submodule');
        break;
      case 'manifest':
        pick(declared, 'manifest');
        break;
      case 'release':
        pick(latest, 'release');
        break;
      default:
        pick(pinned, 'submodule');
        pick(declared, 'manifest');
    }

    let drift: ComponentSnapshot['drift'] = 'unknown';
    if (effectiveVersion && latest)
      drift = compareVersions(effectiveVersion, latest) === 0 ? 'aligned' : 'drift';
    let manifestConsistency: ComponentSnapshot['manifestConsistency'] = 'unknown';
    if (declared && pinned)
      manifestConsistency = compareVersions(declared, pinned) === 0 ? 'consistent' : 'mismatch';

    return {
      id: comp.id,
      name: comp.name,
      type: comp.type,
      repository: toRepositoryInfo(ctx, data),
      versionSource: comp.versionSource,
      declaredVersion: declared,
      latestRelease,
      submodule,
      pin,
      effectiveVersion,
      effectiveVersionSource,
      manifestConsistency,
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
