import { dirname } from 'node:path';
import type { ProviderId, ProvidersFile } from '@model/index';
import type { Clock } from '../../util/clock';
import { createArgoCdProvider } from './argocd';
import type { ProviderAuth } from './auth';
import { createHarborProvider } from './harbor';
import { createExternalClient } from './http';
import { createMockExternalProviders } from './mock';
import { createSonarQubeProvider } from './sonarqube';
import type { ExternalProviders } from './types';

/**
 * The providers that are on, ready to use (null = off: nothing is ever contacted). With the mock
 * source they read `<dir>/<id>.json` fixtures; otherwise each gets its own audited HTTP client
 * pinned to the host of its `baseUrl`. The credential only goes into the client.
 */
export function createExternalProviders(
  providers: ProvidersFile,
  auth: ProviderAuth,
  opts: { mock: false } | { mock: true; providersFile: string; clock: Clock },
): ExternalProviders {
  if (opts.mock)
    return createMockExternalProviders(dirname(opts.providersFile), opts.clock, providers);
  const client = (id: ProviderId) =>
    createExternalClient({
      id,
      baseUrl: providers[id].baseUrl!,
      timeoutSeconds: providers[id].timeoutSeconds,
      authHeader: auth[id].authHeader,
    });
  return {
    sonarqube: providers.sonarqube.enabled ? createSonarQubeProvider(client('sonarqube')) : null,
    harbor: providers.harbor.enabled ? createHarborProvider(client('harbor')) : null,
    argocd: providers.argocd.enabled ? createArgoCdProvider(client('argocd')) : null,
  };
}
