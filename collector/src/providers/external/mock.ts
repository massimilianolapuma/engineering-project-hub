import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderId, ProvidersFile } from '@model/index';
import type { Clock } from '../../util/clock';
import { resolveTokens } from '../mock/mock-provider';
import { fail, ok, type ProviderError, type ProviderResult } from '../types';
import type {
  ArgoApplicationDTO,
  DeploymentProvider,
  ExternalProviders,
  HarborArtifactDTO,
  QualityProvider,
  RegistryProvider,
  SonarProjectDTO,
} from './types';

/**
 * Mock external providers (fixtures/providers/<id>.json, all synthetic). A fixture is
 * `{ "<item key>": DTO | { "$error": ProviderError } }`, with "@now±N" date tokens. A missing
 * file or key is `not-found`, like an item the real service does not know.
 */
interface ErrorFixture {
  $error: ProviderError;
}
const isError = (v: unknown): v is ErrorFixture =>
  typeof v === 'object' && v !== null && '$error' in v;
const NOT_FOUND: ProviderError = { classification: 'not-found', httpStatus: 404 };

function fixtureLoader(dir: string, clock: Clock) {
  const cache = new Map<ProviderId, Promise<Record<string, unknown>>>();
  const load = (id: ProviderId): Promise<Record<string, unknown>> => {
    let hit = cache.get(id);
    if (!hit) {
      hit = readFile(join(dir, `${id}.json`), 'utf8').then(
        (text) => resolveTokens(JSON.parse(text) as Record<string, unknown>, clock()),
        () => ({}),
      );
      cache.set(id, hit);
    }
    return hit;
  };
  return async function lookup<T>(id: ProviderId, key: string): Promise<ProviderResult<T>> {
    const value = (await load(id))[key];
    if (value === undefined) return fail(NOT_FOUND);
    return isError(value) ? fail(value.$error) : ok(value as T);
  };
}

export function createMockExternalProviders(
  dir: string,
  clock: Clock,
  providers: ProvidersFile,
): ExternalProviders {
  const lookup = fixtureLoader(dir, clock);
  const sonarqube: QualityProvider = {
    id: 'sonarqube',
    getProject: (key) => lookup<SonarProjectDTO>('sonarqube', key),
  };
  const harbor: RegistryProvider = {
    id: 'harbor',
    getArtifact: (project, repository, reference) =>
      lookup<HarborArtifactDTO>('harbor', `${project}/${repository}:${reference}`),
  };
  const argocd: DeploymentProvider = {
    id: 'argocd',
    getApplication: (app) =>
      lookup<ArgoApplicationDTO>('argocd', `${app.namespace ?? '-'}/${app.name}`),
  };
  return {
    sonarqube: providers.sonarqube.enabled ? sonarqube : null,
    harbor: providers.harbor.enabled ? harbor : null,
    argocd: providers.argocd.enabled ? argocd : null,
  };
}
