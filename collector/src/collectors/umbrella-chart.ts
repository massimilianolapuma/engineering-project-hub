import type { FileDTO, ProviderResult } from '../providers/types';
import type { BuildContext } from '../normalizers/model';
import { parseManifest, toEnvironments } from '../normalizers/versions';
import { compareVersions, normaliseVersion, parseVersion } from '../util/semver';
import { call, type CollectContext, type RawProjectData } from './collect';

/*
 * Raw reads of the umbrella chart (spec 2026-11-18 5.2): the chart file on the default branch,
 * at the coordinator release, and at the tag of each distinct environment version. Parsing
 * happens later, in the normaliser. Read-only GETs.
 */

export interface ChartRead {
  ref: string;
  file: ProviderResult<FileDTO>;
}

export interface UmbrellaRaw {
  main: ProviderResult<FileDTO>;
  /** null when the coordinator has neither a release nor a tag. */
  release: ChartRead | null;
  /** By environment id; 'skipped' = over MAX_UMBRELLA_TAG_READS. Environments without a tag are absent. */
  environments: Map<string, ChartRead | 'skipped'>;
}

/** Distinct environment tags read per project, newest first; the rest are skipped. */
export const MAX_UMBRELLA_TAG_READS = 10;

/** Tag to read for each environment whose effective version is semver (branch deployments get none). */
export function environmentVersionRefs(
  raw: RawProjectData,
  tagPrefix: string,
): Map<string, string> {
  const refs = new Map<string, string>();
  // Throwaway context: the snapshot build parses the manifest again and records its errors.
  const scratch: BuildContext = {
    projectId: raw.config.id,
    policies: undefined as never,
    now: new Date(0),
    errors: [],
  };
  const { manifest } = parseManifest(scratch, raw);
  const environments = toEnvironments(
    raw.config,
    manifest,
    null,
    raw.argocd,
    raw.coordinatorTags?.ok ? raw.coordinatorTags.data : [],
    [],
    raw.environmentStates,
  );
  for (const env of environments) {
    const version = normaliseVersion(env.version);
    if (version && parseVersion(version)) refs.set(env.id, `${tagPrefix}${version}`);
  }
  return refs;
}

export async function collectUmbrellaCharts(
  ctx: CollectContext,
  raws: RawProjectData[],
): Promise<void> {
  await Promise.all(
    raws.map(async (raw) => {
      const umbrella = raw.config.coordinator.umbrellaChart;
      const coordinator = raw.repos[0];
      if (!umbrella || !coordinator?.repo.ok) return;
      const repository = raw.config.coordinator.repository;
      const read = (ref?: string) =>
        call(ctx, `chart:${repository}:${umbrella.path}@${ref ?? 'default'}`, () =>
          ctx.provider.getFile(repository, umbrella.path, ref),
        );
      const readRef = async (ref: string): Promise<ChartRead> => ({ ref, file: await read(ref) });

      const main = await read();
      const releaseRef = coordinator.release.ok
        ? coordinator.release.data.tagName
        : coordinator.tag?.ok
          ? coordinator.tag.data.name
          : null;
      const release = releaseRef ? await readRef(releaseRef) : null;

      const refs = environmentVersionRefs(raw, umbrella.tagPrefix);
      const prefixLength = umbrella.tagPrefix.length;
      const tags = [...new Set(refs.values())].sort(
        (a, b) => compareVersions(b.slice(prefixLength), a.slice(prefixLength)) ?? 0,
      );
      const reads = new Map<string, ChartRead | 'skipped'>();
      for (const [i, tag] of tags.entries())
        reads.set(tag, i < MAX_UMBRELLA_TAG_READS ? await readRef(tag) : 'skipped');
      const environments = new Map<string, ChartRead | 'skipped'>();
      for (const [id, tag] of refs) environments.set(id, reads.get(tag)!);

      raw.umbrella = { main, release, environments };
    }),
  );
}
