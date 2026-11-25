import { mapChartToComponents, parseUmbrellaChart } from '../normalizers/umbrella-chart';
import { ok, type ProviderResult } from '../providers/types';
import { call, skipped, type CollectContext, type RawProjectData } from './collect';
import { readLedger, type LedgerRead } from './environment-states';

/*
 * Own deployments of the components marked `deployments: true` (spec 2026-11-20 5.2): the GitHub
 * Deployments of the component's repository, once per project environment. Read-only GETs, the
 * same read as the project environments (one list and at most 10 status reads).
 */

export interface ComponentDeploymentRead {
  environmentId: string;
  /** GitHub environment name that was asked for (`githubEnvironment`, else the id). */
  environment: string;
  result: ProviderResult<LedgerRead>;
}
/** By component id; a component that was not read has no entry. */
export type ComponentDeploymentsRaw = Map<string, ComponentDeploymentRead[]>;

/**
 * Components the umbrella chart on the default branch contains; null when the project has no
 * umbrella chart or the chart could not be read (membership unknown: the flag then decides).
 */
function umbrellaMembers(raw: RawProjectData): Set<string> | null {
  const main = raw.umbrella?.main;
  if (!main?.ok) return null;
  const chart = parseUmbrellaChart(main.data.text);
  return chart ? new Set(mapChartToComponents(raw.config, chart).byComponent.keys()) : null;
}

export async function collectComponentDeployments(
  ctx: CollectContext,
  raws: RawProjectData[],
): Promise<void> {
  await Promise.all(
    raws.map(async (raw) => {
      const flagged = raw.config.components.filter((c) => c.deployments);
      if (flagged.length === 0) return;
      const members = umbrellaMembers(raw);
      const reads: ComponentDeploymentsRaw = new Map();
      for (const component of flagged) {
        // In the umbrella chart: the chart is its source.
        if (members?.has(component.id)) continue;
        // Repository unreadable: no call, but the component keeps its own row with every cell
        // unknown (never "outside the umbrella"); the failure is already the repository error.
        const unreadable = raw.repos.find(
          (r) => r.repository === component.repository && !r.repo.ok,
        );
        const entries: ComponentDeploymentRead[] = [];
        for (const env of raw.config.environments) {
          const environment = env.githubEnvironment ?? env.id;
          if (unreadable) {
            entries.push({ environmentId: env.id, environment, result: skipped(unreadable.repo) });
            continue;
          }
          const read = await call(
            ctx,
            `component-deployments:${raw.config.id}:${component.id}:${env.id}`,
            async () =>
              // The project signal's `environment` and `sources` belong to the repository that
              // signal reads, never to the component's.
              ok(
                await readLedger(ctx.provider, component.repository, environment, {
                  tagPrefix: component.releaseTagPrefix ?? 'v',
                }),
              ),
          );
          // An unexpected exception is a failed read; a provider without deployments is no read.
          const result = read.ok ? read.data : read;
          if (result) entries.push({ environmentId: env.id, environment, result });
        }
        if (entries.length > 0) reads.set(component.id, entries);
      }
      raw.componentDeployments = reads;
    }),
  );
}
