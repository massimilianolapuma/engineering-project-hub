import type { ProviderId, ProvidersFile } from '@model/index';

/**
 * A structural configuration error (exit 1), like a partial GitHub App. Messages name the
 * variables, never their values.
 */
export class ProviderAuthError extends Error {
  override readonly name = 'ProviderAuthError';
}

export type ProviderAuth = Record<ProviderId, { enabled: boolean; authHeader: string | null }>;

const present = (v: string | undefined): v is string =>
  typeof v === 'string' && v.trim().length > 0;

/**
 * Credentials come from the environment only: SONARQUBE_TOKEN, HARBOR_ROBOT_NAME +
 * HARBOR_ROBOT_SECRET, ARGOCD_TOKEN. A disabled provider ignores its variables. An enabled
 * provider without a credential gets `authHeader: null` (its items become not-authorised, the
 * run continues). Harbor with only one of name / secret is a ProviderAuthError.
 * With `mock`, an enabled provider gets a placeholder header the mock never uses.
 */
export function resolveProviderAuth(
  providers: ProvidersFile,
  env: NodeJS.ProcessEnv = process.env,
  opts: { mock?: boolean } = {},
): ProviderAuth {
  const off = { enabled: false, authHeader: null };
  const resolve = (id: ProviderId, header: () => string | null): ProviderAuth[ProviderId] => {
    if (!providers[id].enabled) return off;
    return { enabled: true, authHeader: opts.mock ? 'mock' : header() };
  };
  const bearer = (value: string | undefined) => (present(value) ? `Bearer ${value}` : null);

  return {
    sonarqube: resolve('sonarqube', () => bearer(env.SONARQUBE_TOKEN)),
    harbor: resolve('harbor', () => {
      const name = env.HARBOR_ROBOT_NAME;
      const secret = env.HARBOR_ROBOT_SECRET;
      if (present(name) !== present(secret)) {
        throw new ProviderAuthError(
          'Harbor credentials are incomplete: HARBOR_ROBOT_NAME and HARBOR_ROBOT_SECRET must both be set.',
        );
      }
      return present(name) && present(secret)
        ? `Basic ${Buffer.from(`${name}:${secret}`).toString('base64')}`
        : null;
    }),
    argocd: resolve('argocd', () => bearer(env.ARGOCD_TOKEN)),
  };
}
