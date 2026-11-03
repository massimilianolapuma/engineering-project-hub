import type { ProjectConfig, ProviderId, ProvidersFile } from '@model/index';
import { harborImages, harborKey } from '../normalizers/containers';
import type {
  ArgoApplicationDTO,
  ExternalProviders,
  HarborArtifactDTO,
  SonarProjectDTO,
} from '../providers/external/types';
import { fail, type ProviderResult } from '../providers/types';
import { memoize } from '../util/concurrency';
import type { RawProjectData } from './collect';

/** What one run asked of each external provider (items = distinct items, errors = failed ones). */
export type ExternalUsage = Record<
  ProviderId,
  { items: number; errors: number; results: ProviderResult<unknown>[] }
>;

export const emptyUsage = (): ExternalUsage => ({
  sonarqube: { items: 0, errors: 0, results: [] },
  harbor: { items: 0, errors: 0, results: [] },
  argocd: { items: 0, errors: 0, results: [] },
});

/** Item beyond `maxItems`: not asked, so unknown (never 0). */
const CAP_REACHED = (): ProviderResult<never> =>
  fail({ classification: 'error', message: 'cap reached' });

interface Runner {
  <T>(
    id: ProviderId,
    key: string,
    task: () => Promise<ProviderResult<T>>,
  ): Promise<ProviderResult<T>>;
}

/**
 * Reads the mapped items of every provider that is on: SonarQube project keys, Harbor image
 * references, Argo CD applications. Items are numbered in catalog order before anything runs,
 * so the per-provider `maxItems` cap always drops the same ones. A provider that is off is never
 * contacted: its maps stay empty. `versions` are the components' effective versions, per project.
 */
export async function collectExternal(
  external: ExternalProviders,
  providers: ProvidersFile,
  raws: RawProjectData[],
  versions: Map<string, Map<string, string | null>>,
  cache: Map<string, Promise<unknown>>,
): Promise<ExternalUsage> {
  const usage = emptyUsage();
  const admitted = new Map<string, boolean>();
  // Called synchronously, in catalog order, so the cap is deterministic.
  const admit = (id: ProviderId, key: string): boolean => {
    const k = `${id}|${key}`;
    let ok = admitted.get(k);
    if (ok === undefined) {
      ok = usage[id].items < providers[id].maxItems;
      admitted.set(k, ok);
      if (ok) usage[id].items++;
    }
    return ok;
  };
  const record = (id: ProviderId, key: string, result: ProviderResult<unknown>) => {
    const k = `${id}|${key}|recorded`;
    if (admitted.has(k)) return;
    admitted.set(k, true);
    usage[id].results.push(result);
    if (!result.ok) usage[id].errors++;
  };
  const run: Runner = (id, key, task) =>
    memoize(cache as Map<string, Promise<ProviderResult<never>>>, `ext:${id}:${key}`, async () => {
      let result: ProviderResult<never>;
      if (!admit(id, key)) result = CAP_REACHED();
      else {
        try {
          result = (await task()) as ProviderResult<never>;
        } catch (e) {
          result = fail({ classification: 'error', message: (e as Error)?.name ?? 'Error' });
        }
      }
      record(id, key, result);
      return result;
    });

  // Admission happens when run() starts, which is synchronous up to the first await: start the
  // items project by project, in order, then wait for all of them.
  const pending: Promise<unknown>[] = [];
  for (const raw of raws) {
    const config = raw.config;
    const sonar = new Map<string, ProviderResult<SonarProjectDTO>>();
    const harbor = new Map<string, ProviderResult<HarborArtifactDTO>>();
    const argocd = new Map<string, ProviderResult<ArgoApplicationDTO> | 'off'>();
    raw.sonar = sonar;
    raw.harbor = harbor;
    raw.argocd = argocd;

    if (external.sonarqube) {
      const sonarqube = external.sonarqube;
      for (const [key, branch] of sonarKeys(config)) {
        pending.push(
          run('sonarqube', key, () => sonarqube.getProject(key, branch)).then((r) =>
            sonar.set(key, r),
          ),
        );
      }
    }
    if (external.harbor) {
      const registry = external.harbor;
      for (const image of harborImages(config, versions.get(config.id) ?? new Map())) {
        if (image.reference === null) continue; // unknown version: never asked
        const key = harborKey(image);
        const reference = image.reference;
        pending.push(
          run('harbor', key, () =>
            registry.getArtifact(image.project, image.repository, reference),
          ).then((r) => harbor.set(key, r)),
        );
      }
    }
    if (external.argocd) {
      const deployments = external.argocd;
      for (const env of config.environments) {
        const app = env.argocdApplication;
        if (!app) continue;
        const key = `${app.namespace ?? '-'}/${app.name}`;
        pending.push(
          run('argocd', key, () => deployments.getApplication(app)).then((r) =>
            argocd.set(env.id, r),
          ),
        );
      }
    } else {
      for (const env of config.environments) if (env.argocdApplication) argocd.set(env.id, 'off');
    }
  }
  await Promise.all(pending);
  return usage;
}

/** Mapped SonarQube project keys of a project, with their branch (first mapping of a key wins). */
function sonarKeys(config: ProjectConfig): Map<string, string | undefined> {
  const keys = new Map<string, string | undefined>();
  const targets = [config.coordinator, ...config.components];
  for (const t of targets)
    if (t.sonarProjectKey && !keys.has(t.sonarProjectKey))
      keys.set(t.sonarProjectKey, t.sonarBranch);
  return keys;
}
