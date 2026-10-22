import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderId, ProvidersFile } from '@model/index';
import type { Clock } from '../../util/clock';
import { resolveTokens } from '../mock/mock-provider';
import { fail, ok, type ProviderError, type ProviderResult } from '../types';
import { createArgoCdProvider } from './argocd';
import { createHarborProvider } from './harbor';
import type {
  DeploymentProvider,
  ExternalProviders,
  QualityProvider,
  RegistryProvider,
  SonarProjectDTO,
} from './types';

/**
 * Mock external providers (fixtures/providers/<id>.json, all synthetic). A fixture is
 * `{ "<item key>": response | { "$error": ProviderError } }`, with "@now±N" date tokens. SonarQube
 * fixtures are DTOs; Harbor and Argo CD fixtures are raw API responses (see below). A missing
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
  // Harbor and Argo CD fixtures are raw API responses: they go through the same projection as
  // the real providers, so whatever the projection must drop (scanner names, repository URLs)
  // can be put in them and is proved to stay out.
  const harbor: RegistryProvider = createHarborProvider({
    getJson: (_template, params) =>
      lookup<unknown>('harbor', `${params.project}/${params.repository}:${params.reference}`),
  });
  const argocd: DeploymentProvider = createArgoCdProvider({
    getJson: (_template, params, query) =>
      lookup<unknown>('argocd', `${query?.appNamespace ?? '-'}/${params.name}`),
  });
  return {
    sonarqube: providers.sonarqube.enabled ? sonarqube : null,
    harbor: providers.harbor.enabled ? harbor : null,
    argocd: providers.argocd.enabled ? argocd : null,
  };
}
