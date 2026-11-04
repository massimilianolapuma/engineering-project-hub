import { readBodyCapped } from '../../shared/http/bounded-read';

/*
 * Read-only Azure DevOps client of the bridge (deployments ledger spec §5.3). Endpoints confirmed
 * on Microsoft Learn on 2026-11-04, api-version 7.1:
 * - Environments - List:   GET {org}/{project}/_apis/distributedtask/environments?name=
 * - Environment deployment records - List:
 *                          GET {org}/{project}/_apis/distributedtask/environments/{id}/environmentdeploymentrecords?top=
 *   (one record per deployment job: id, result TaskResult, startTime, finishTime, definition {id}
 *    = pipeline, owner {id} = run (build) id, stageName, jobName, stageAttempt)
 * - Pipelines Runs - Get:  GET {org}/{project}/_apis/pipelines/{pipelineId}/runs/{runId}
 *   (resources.repositories[alias].version = commit SHA)
 * Only https://dev.azure.com is called; every call has a timeout and a capped body.
 */

export const ADO_API_VERSION = '7.1';
const HOST = 'https://dev.azure.com';
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 2 * 1024 * 1024;
/** Records read per environment and run. */
export const MAX_ADO_RECORDS = 100;

export interface AdoRecord {
  id: number;
  /** TaskResult: succeeded, succeededWithIssues, failed, canceled, skipped, abandoned; null while running. */
  result: string | null;
  startTime: string | null;
  finishTime: string | null;
  pipelineId: number;
  runId: number;
  attempt: number;
  /** Stage and job of the record: ADO keeps one record per deployment job. */
  stage: string;
  job: string;
  runUrl: string;
}

export interface AdoClient {
  environmentId(org: string, project: string, name: string): Promise<number | null>;
  deploymentRecords(org: string, project: string, envId: number): Promise<AdoRecord[]>;
  runCommit(
    org: string,
    project: string,
    pipelineId: number,
    runId: number,
    alias: string,
  ): Promise<string | null>;
}

export class AdoError extends Error {
  constructor(readonly status: number | 'network' | 'invalid' | 'too-large') {
    super(`Azure DevOps request failed (${status})`);
  }
}

const seg = encodeURIComponent;
const SHA = /^[0-9a-f]{40}$/;

export function createAdoClient(o: {
  authHeader: string;
  fetch?: typeof globalThis.fetch;
}): AdoClient {
  const f = o.fetch ?? globalThis.fetch;
  async function get(path: string, query: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`${HOST}/${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    url.searchParams.set('api-version', ADO_API_VERSION);
    let res: Response;
    try {
      res = await f(url, {
        headers: { Authorization: o.authHeader, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new AdoError('network');
    }
    if (!res.ok) throw new AdoError(res.status);
    const bytes = await readBodyCapped(res, MAX_BYTES);
    if (!bytes) throw new AdoError('too-large');
    try {
      return JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
      throw new AdoError('invalid');
    }
  }
  const list = (v: unknown): Record<string, unknown>[] => {
    const arr = Array.isArray(v) ? v : (v as { value?: unknown })?.value;
    return Array.isArray(arr)
      ? (arr.filter((x) => x && typeof x === 'object') as Record<string, unknown>[])
      : [];
  };
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const idOf = (v: unknown) => num((v as { id?: unknown } | null)?.id ?? null);

  return {
    async environmentId(org, project, name) {
      const v = await get(`${seg(org)}/${seg(project)}/_apis/distributedtask/environments`, {
        name,
      });
      const hit = list(v).find((e) => str(e.name)?.toLowerCase() === name.toLowerCase());
      return hit ? num(hit.id) : null;
    },
    async deploymentRecords(org, project, envId) {
      const v = await get(
        `${seg(org)}/${seg(project)}/_apis/distributedtask/environments/${envId}/environmentdeploymentrecords`,
        { top: String(MAX_ADO_RECORDS) },
      );
      return list(v).flatMap((r) => {
        const id = num(r.id);
        const runId = idOf(r.owner);
        const pipelineId = idOf(r.definition);
        if (id === null || runId === null || pipelineId === null) return [];
        return [
          {
            id,
            result: str(r.result),
            startTime: str(r.startTime),
            finishTime: str(r.finishTime),
            pipelineId,
            runId,
            attempt: num(r.stageAttempt) ?? 1,
            stage: str(r.stageName) ?? '',
            job: str(r.jobName) ?? '',
            runUrl: `${HOST}/${seg(org)}/${seg(project)}/_build/results?buildId=${runId}`,
          },
        ];
      });
    },
    async runCommit(org, project, pipelineId, runId, alias) {
      const v = (await get(
        `${seg(org)}/${seg(project)}/_apis/pipelines/${pipelineId}/runs/${runId}`,
      )) as {
        resources?: { repositories?: Record<string, { version?: unknown }> };
      };
      const version = v?.resources?.repositories?.[alias]?.version;
      return typeof version === 'string' && SHA.test(version) ? version : null;
    },
  };
}
