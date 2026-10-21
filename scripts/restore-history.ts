/**
 * Restores the previous history from this repository's own newest "hub-history" artifact.
 * Read-only (GET) with the workflow GITHUB_TOKEN (actions: read). Always exits 0: a failed
 * restore starts a fresh history, it never fails the collection. Never prints error objects.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { retry } from '@octokit/plugin-retry';
import { Octokit } from '@octokit/rest';
import {
  candidateArtifacts,
  HISTORY_ARTIFACT,
  MAX_ARTIFACT_BYTES,
  runIsTrusted,
  type ArtifactLike,
  type RestoreOutcome,
} from '../collector/src/history/select-artifact';
import { classifyGitHubError } from '../collector/src/providers/github/errors';
import { readZipEntry } from '../collector/src/util/zip';

const HISTORY_FILE = 'history.json';
const HISTORY_MAX_BYTES = 8_388_608;

const RestoreOctokit = Octokit.plugin(retry);
export type RestoreClient = InstanceType<typeof RestoreOctokit>;

export interface RestoreOptions {
  owner: string;
  repo: string;
  currentRunId: number;
  out: string;
}

export function createRestoreClient(token: string, baseUrl?: string): RestoreClient {
  return new RestoreOctokit({
    auth: token,
    ...(baseUrl ? { baseUrl } : {}),
    userAgent: 'engineering-project-hub-history-restore',
    request: { retries: 2 },
  });
}

function failure(e: unknown): RestoreOutcome {
  const { classification } = classifyGitHubError(e);
  return {
    state: 'failed',
    reason: classification === 'not-authorised' ? 'not-authorised' : 'api-error',
  };
}

export async function restoreHistory(
  octokit: RestoreClient,
  o: RestoreOptions,
): Promise<RestoreOutcome> {
  const { owner, repo } = o;
  let candidates: ArtifactLike[];
  try {
    const { data: repository } = await octokit.rest.repos.get({ owner, repo });
    const { data } = await octokit.rest.actions.listArtifactsForRepo({
      owner,
      repo,
      name: HISTORY_ARTIFACT,
      per_page: 30,
    });
    candidates = candidateArtifacts(data.artifacts as ArtifactLike[], {
      repositoryId: repository.id,
      defaultBranch: repository.default_branch,
      currentRunId: o.currentRunId,
    });
  } catch (e) {
    return failure(e);
  }

  for (const artifact of candidates) {
    try {
      const { data: run } = await octokit.rest.actions.getWorkflowRun({
        owner,
        repo,
        run_id: artifact.workflow_run?.id ?? 0,
      });
      if (!runIsTrusted({ id: run.id, path: run.path, event: run.event })) continue;
      const res = await octokit.rest.actions.downloadArtifact({
        owner,
        repo,
        artifact_id: artifact.id,
        archive_format: 'zip',
      });
      const bytes = new Uint8Array(res.data as ArrayBuffer);
      if (bytes.byteLength > MAX_ARTIFACT_BYTES) return { state: 'failed', reason: 'bad-archive' };
      let text: string;
      try {
        text = readZipEntry(bytes, HISTORY_FILE, HISTORY_MAX_BYTES);
      } catch {
        return { state: 'failed', reason: 'bad-archive' };
      }
      const dir = resolve(o.out);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, HISTORY_FILE), text);
      return { state: 'restored' };
    } catch (e) {
      return failure(e);
    }
  }
  return { state: 'none', reason: 'no-artifact' };
}

function report(outcome: RestoreOutcome): void {
  const reason = 'reason' in outcome ? outcome.reason : '';
  const ghOutput = process.env.GITHUB_OUTPUT;
  if (ghOutput) appendFileSync(ghOutput, `state=${outcome.state}\nreason=${reason}\n`);
  console.log(`History restore: ${outcome.state}${reason ? ` (${reason})` : ''}`);
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  const out = i >= 0 ? args[i + 1] : undefined;
  const token = process.env.GITHUB_TOKEN ?? '';
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
  const currentRunId = Number(process.env.GITHUB_RUN_ID);
  let outcome: RestoreOutcome;
  if (!out || !token || !owner || !repo || !Number.isInteger(currentRunId)) {
    outcome = { state: 'failed', reason: 'api-error' };
  } else {
    const client = createRestoreClient(token, process.env.GITHUB_API_URL);
    outcome = await restoreHistory(client, { owner, repo, currentRunId, out });
  }
  report(outcome);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => report({ state: 'failed', reason: 'api-error' }));
}
