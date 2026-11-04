import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import type { LedgerPayload } from '@model/index';

/*
 * GitHub clients of the ledger writers (ADR 0015, D2, D11). Two Apps, two jobs:
 * - the deployment App writes: every token is narrowed to one repository and to
 *   `deployments: write`, so a writer key never reads code;
 * - the hub's read-only App reads (commit exists, file at a commit, tag commit).
 * The only GitHub endpoints used: deployments, deployment statuses, commits, contents.
 */

export interface DeploymentRequest {
  ref: string;
  environment: string;
  auto_merge: false;
  required_contexts: [];
  transient_environment: false;
  production_environment: boolean;
  description: string;
  payload: LedgerPayload;
}

export interface LedgerGitHub {
  listDeployments(
    repo: string,
    sha: string,
    environment: string,
  ): Promise<{ id: number; payload: unknown; statuses: string[] }[]>;
  createDeployment(repo: string, req: DeploymentRequest): Promise<number>;
  createStatus(
    repo: string,
    id: number,
    state: 'success' | 'failure',
    logUrl: string,
  ): Promise<void>;
}

export interface LedgerReader {
  commitExists(repo: string, sha: string): Promise<boolean | 'unknown'>;
  fileAt(repo: string, path: string, sha: string): Promise<string | null>;
  tagCommit(repo: string, tag: string): Promise<string | null>;
}

const split = (repo: string) => {
  const [owner = '', name = ''] = repo.split('/');
  return { owner, repo: name };
};

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

/** HTTP status of an Octokit error, or null. */
const statusOf = (e: unknown): number | null =>
  typeof e === 'object' && e !== null && typeof (e as { status?: unknown }).status === 'number'
    ? (e as { status: number }).status
    : null;

export interface AppClientsOptions {
  writeAppId: string;
  writeKey: string;
  readAppId?: string;
  readKey?: string;
  /** Tests only. */
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
}

export function createAppClients(o: AppClientsOptions): {
  writer(repo: string): Promise<LedgerGitHub>;
  reader(repo: string): Promise<LedgerReader>;
} {
  const request = o.fetch ? { fetch: o.fetch } : undefined;
  const common = {
    userAgent: 'engineering-project-hub-ledger',
    log: silentLog,
    ...(o.baseUrl ? { baseUrl: o.baseUrl } : {}),
    ...(request ? { request } : {}),
  };

  /** An installation client narrowed to one repository and the given permissions. */
  async function installation(
    appId: string,
    privateKey: string,
    repo: string,
    permissions: Record<string, 'read' | 'write'>,
  ): Promise<Octokit> {
    const app = new Octokit({
      ...common,
      authStrategy: createAppAuth,
      auth: { appId, privateKey },
    });
    const { data } = await app.rest.apps.getRepoInstallation(split(repo));
    // Narrowing options are only honoured by an explicit installation token request.
    const auth = createAppAuth({ appId, privateKey, request: app.request });
    const { token } = await auth({
      type: 'installation',
      installationId: data.id,
      repositoryNames: [split(repo).repo],
      permissions,
    });
    return new Octokit({ ...common, auth: token });
  }

  return {
    async writer(repo) {
      const gh = await installation(o.writeAppId, o.writeKey, repo, { deployments: 'write' });
      return {
        async listDeployments(r, sha, environment) {
          const { data } = await gh.rest.repos.listDeployments({
            ...split(r),
            sha,
            environment,
            per_page: 100,
          });
          return Promise.all(
            data.map(async (d) => {
              const statuses = await gh.rest.repos.listDeploymentStatuses({
                ...split(r),
                deployment_id: d.id,
                per_page: 100,
              });
              return { id: d.id, payload: d.payload, statuses: statuses.data.map((s) => s.state) };
            }),
          );
        },
        async createDeployment(r, req) {
          const res = await gh.rest.repos.createDeployment({ ...split(r), ...req });
          if (res.status !== 201 || !('id' in res.data)) throw new Error('deployment not created');
          return res.data.id;
        },
        async createStatus(r, id, state, logUrl) {
          await gh.rest.repos.createDeploymentStatus({
            ...split(r),
            deployment_id: id,
            state,
            log_url: logUrl,
          });
        },
      };
    },
    async reader(repo) {
      if (!o.readAppId || !o.readKey) throw new Error('read App not configured');
      const gh = await installation(o.readAppId, o.readKey, repo, {
        contents: 'read',
        metadata: 'read',
      });
      const commit = async (r: string, ref: string): Promise<string | null | 'unknown'> => {
        try {
          const { data } = await gh.rest.repos.getCommit({ ...split(r), ref });
          return data.sha;
        } catch (e) {
          const s = statusOf(e);
          return s === 404 || s === 422 ? null : 'unknown';
        }
      };
      return {
        async commitExists(r, sha) {
          const c = await commit(r, sha);
          return c === 'unknown' ? 'unknown' : c !== null;
        },
        async tagCommit(r, tag) {
          const c = await commit(r, `refs/tags/${tag}`);
          return c === 'unknown' ? null : c;
        },
        async fileAt(r, path, sha) {
          try {
            const { data } = await gh.rest.repos.getContent({ ...split(r), path, ref: sha });
            if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) return null;
            return Buffer.from(data.content, 'base64').toString('utf8');
          } catch {
            return null;
          }
        },
      };
    },
  };
}
