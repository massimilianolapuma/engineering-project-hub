import type { DataSource, Policies } from '@model/index';
import type { EnvironmentDTO, ProviderResult } from '../providers/types';
import { call, type CollectContext, type RawProjectData } from './collect';
import { collectDeploySignal, type DeploySignalResult } from './deploy-signals';

/*
 * Control map readings that need their own calls (spec 2026-11-04 §5.2–§5.3): the GitHub
 * environments of the coordinator and the deploy events of the delivery environment. Made only
 * when the map is published for this audience (C9): restricted audience, or mock data.
 */

export interface ControlMapRaw {
  /** null = not read (the provider cannot list environments, or the coordinator is unreadable). */
  environments: ProviderResult<EnvironmentDTO[]> | null;
  /** null = the project has no environment. */
  deploy: (DeploySignalResult & { environment: string }) | null;
}

export const controlMapPublished = (policies: Policies, dataSource: DataSource): boolean =>
  policies.controlMap.enabled &&
  (policies.publication.audience === 'restricted' || dataSource === 'mock');

/** The environment the delivery metrics use: the `delivery` one, else the last. */
export const deliveryEnvironment = (config: RawProjectData['config']) =>
  config.environments.find((e) => e.delivery) ?? config.environments.at(-1) ?? null;

export async function collectControlMap(
  ctx: CollectContext,
  raws: RawProjectData[],
  now: Date,
): Promise<void> {
  const p = ctx.provider;
  await Promise.all(
    raws.map(async (raw) => {
      const coordinator = raw.repos[0];
      const repository = raw.config.coordinator.repository;
      const listEnvironments = p.listEnvironments?.bind(p);
      const environments =
        coordinator?.repo.ok && listEnvironments
          ? await call(ctx, `envs:${repository}`, () => listEnvironments(repository))
          : null;
      const env = deliveryEnvironment(raw.config);
      const deploy = env
        ? {
            ...(await ctx.limit(() =>
              collectDeploySignal(p, raw, env, now, ctx.policies.controlMap.windows),
            )),
            environment: env.name,
          }
        : null;
      raw.controlMap = { environments, deploy };
    }),
  );
}
