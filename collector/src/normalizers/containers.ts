import type { Policies, ProjectConfig } from '@model/index';
import type { RawProjectData } from '../collectors/collect';
import { coordinatorVersion, parseManifest, resolveSubmodules, toComponents } from './versions';
import { toReleaseInfo, type BuildContext } from './model';

/** A Harbor image of a component, with the reference its version renders to (null = unknown). */
export interface ImageRef {
  componentId: string;
  project: string;
  repository: string;
  reference: string | null;
}

/** Harbor accepts tag names of this form; anything else is never put in a request path. */
export const HARBOR_TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

export const harborKey = (i: Pick<ImageRef, 'project' | 'repository' | 'reference'>): string =>
  `${i.project}/${i.repository}:${i.reference ?? ''}`;

/**
 * Mapped images of a project. The reference is the component's effective version (the
 * coordinator's version for the coordinator) rendered with the image's `tagTemplate`. A version
 * that is unknown, or that renders to something that is not a valid tag (it comes from
 * repository content), gives `reference: null`: that image is "unknown" and is never requested.
 */
export function harborImages(
  config: ProjectConfig,
  versions: ReadonlyMap<string, string | null>,
): ImageRef[] {
  const targets = [
    { componentId: 'coordinator', images: config.coordinator.containerImages },
    ...config.components.map((c) => ({ componentId: c.id, images: c.containerImages })),
  ];
  return targets.flatMap((t) =>
    (t.images ?? []).map((image) => {
      const version = versions.get(t.componentId) ?? null;
      const rendered = version ? image.tagTemplate.replace('{version}', version) : null;
      return {
        componentId: t.componentId,
        project: image.project,
        repository: image.repository,
        reference: rendered !== null && HARBOR_TAG.test(rendered) ? rendered : null,
      };
    }),
  );
}

/**
 * Effective version of the coordinator and of each component, computed with the same pure
 * normalisers the snapshot uses (errors go to a throwaway context). Needed before the build to
 * know which image tags to ask Harbor for.
 */
export function effectiveVersions(
  raw: RawProjectData,
  policies: Policies,
  now: Date,
): Map<string, string | null> {
  const ctx: BuildContext = { projectId: raw.config.id, policies, now, errors: [] };
  const { manifest } = parseManifest(ctx, raw);
  const submodules = resolveSubmodules(ctx, raw);
  const coordinatorData = raw.repos[0]!;
  const release = coordinatorData.repo.ok
    ? toReleaseInfo(
        ctx,
        raw.config.coordinator.repository,
        coordinatorData.release,
        coordinatorData.tag,
      )
    : null;
  const versions = new Map<string, string | null>([
    ['coordinator', coordinatorVersion(manifest, release).version],
  ]);
  for (const c of toComponents(ctx, raw, manifest, submodules))
    versions.set(c.id, c.effectiveVersion);
  return versions;
}
