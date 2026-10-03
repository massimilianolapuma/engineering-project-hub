import type { ComponentConfig, ProjectConfig } from '@model/index';
import { githubRepositoryFromUrl, type GitmoduleEntry } from '../util/gitmodules';

export interface SubmoduleAssociation {
  entry: GitmoduleEntry;
  /** Remote reduced to "owner/name" (GitHub only), lower-case. */
  remote: string | null;
  component: ComponentConfig | null;
  association: 'configured-path' | 'repository-url' | 'unmapped';
}

/**
 * Links .gitmodules entries to catalog components: configured `submodulePath` first, then
 * the remote URL (owner/name). Never by repository naming conventions; anything else stays
 * unmapped. Shared by the collector (to know which SHAs to resolve) and the normalizer.
 */
export function associateSubmodules(
  project: ProjectConfig,
  entries: GitmoduleEntry[],
): SubmoduleAssociation[] {
  const coordinator = project.coordinator.repository;
  return entries.map((entry) => {
    const remote = githubRepositoryFromUrl(entry.url, coordinator);
    const byPath = project.components.find((c) => c.submodulePath === entry.path);
    const byUrl = byPath
      ? undefined
      : project.components.find((c) => remote && c.repository.toLowerCase() === remote);
    const component = byPath ?? byUrl ?? null;
    return {
      entry,
      remote,
      component,
      association: byPath ? 'configured-path' : byUrl ? 'repository-url' : 'unmapped',
    };
  });
}
