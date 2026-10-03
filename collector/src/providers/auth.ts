import type { AuthenticationMode, DataSource } from '@model/index';

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigError';
  }
}

export type ResolvedAuth =
  | { mode: 'mock' }
  | { mode: 'github-app'; appId: string; privateKey: string; installationId: number }
  | { mode: 'fine-grained-token' | 'github-token'; token: string };

const present = (v: string | undefined): v is string =>
  typeof v === 'string' && v.trim().length > 0;

/**
 * Credential priority: GitHub App → GH_READ_TOKEN → GITHUB_TOKEN. Mock only when asked for.
 * There is no silent fallback: a partially configured App or a "github" source without
 * credentials is an error, so incomplete data can never pass as complete.
 */
export function resolveAuth(
  source: DataSource,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAuth {
  if (source === 'mock') return { mode: 'mock' };
  const app = { id: env.GH_APP_ID, key: env.GH_APP_PRIVATE_KEY, inst: env.GH_APP_INSTALLATION_ID };
  const appParts = [app.id, app.key, app.inst].filter(present).length;
  if (appParts > 0 && appParts < 3) {
    throw new AuthConfigError(
      'GitHub App credentials are incomplete: GH_APP_ID, GH_APP_PRIVATE_KEY and GH_APP_INSTALLATION_ID must all be set (no fallback to other credentials).',
    );
  }
  if (appParts === 3) {
    const installationId = Number(app.inst);
    if (!Number.isInteger(installationId) || installationId <= 0)
      throw new AuthConfigError('GH_APP_INSTALLATION_ID must be a positive integer.');
    if (!/^\d+$/.test(app.id!.trim())) throw new AuthConfigError('GH_APP_ID must be numeric.');
    return {
      mode: 'github-app',
      appId: app.id!.trim(),
      privateKey: app.key!.replace(/\\n/g, '\n'),
      installationId,
    };
  }
  if (present(env.GH_READ_TOKEN))
    return { mode: 'fine-grained-token', token: env.GH_READ_TOKEN.trim() };
  if (present(env.GITHUB_TOKEN)) return { mode: 'github-token', token: env.GITHUB_TOKEN.trim() };
  throw new AuthConfigError(
    'DATA_SOURCE=github but no credentials found. Configure a GitHub App (GH_APP_ID, GH_APP_PRIVATE_KEY, GH_APP_INSTALLATION_ID), GH_READ_TOKEN or GITHUB_TOKEN — or use DATA_SOURCE=mock.',
  );
}

export const authModeOf = (a: ResolvedAuth): AuthenticationMode => a.mode;
