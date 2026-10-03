import { createAppAuth } from '@octokit/auth-app';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { Octokit } from '@octokit/rest';
import type { AuthenticationMode } from '@model/index';
import type { ResolvedAuth } from '../auth';
import {
  fail,
  ok,
  type CodeScanningAlertDTO,
  type CodeScanningAnalysisDTO,
  type CommitRefDTO,
  type DependabotAlertDTO,
  type FileDTO,
  type ProviderResult,
  type ReleaseDTO,
  type RepositoryDTO,
  type RunFailureDTO,
  type SecretScanningAlertDTO,
  type SourceProvider,
  type SubmoduleRefDTO,
  type TagDTO,
  type WorkflowRunDTO,
} from '../types';
import { classifyGitHubError } from './errors';

const ThrottledOctokit = Octokit.plugin(throttling, retry);
type Client = InstanceType<typeof ThrottledOctokit>;

/** Max pages (100 items each) read per alert list and repository. Documented MVP limit. */
const MAX_ALERT_PAGES = 3;
/** Files above this size are not parsed (manifest / .gitmodules / status file are tiny). */
const MAX_FILE_BYTES = 256 * 1024;

const silentLog = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

export interface ClientOptions {
  baseUrl?: string;
  /** Injected in tests to simulate API responses without network access. */
  fetch?: typeof globalThis.fetch;
}

export function createGitHubClient(
  auth: Exclude<ResolvedAuth, { mode: 'mock' }>,
  opts: ClientOptions = {},
): Client {
  const { baseUrl } = opts;
  const common = {
    userAgent: 'engineering-project-hub-collector',
    ...(baseUrl ? { baseUrl } : {}),
    // Octokit must never print requests: they carry the Authorization header.
    log: silentLog,
    throttle: {
      // Retry once when the wait is short; otherwise surface "rate-limited".
      onRateLimit: (retryAfter: number, _o: unknown, _k: unknown, retryCount: number) =>
        retryCount < 1 && retryAfter <= 60,
      onSecondaryRateLimit: (retryAfter: number, _o: unknown, _k: unknown, retryCount: number) =>
        retryCount < 1 && retryAfter <= 60,
    },
    retry: { doNotRetry: [400, 401, 403, 404, 410, 422, 451] },
    request: {
      // 20 s per request; a hung connection must not stall the scheduled run.
      fetch: (url: string | URL | Request, init?: RequestInit) =>
        (opts.fetch ?? globalThis.fetch)(url, {
          ...init,
          signal: init?.signal ?? AbortSignal.timeout(20_000),
        }),
    },
  };
  if (auth.mode === 'github-app') {
    return new ThrottledOctokit({
      ...common,
      authStrategy: createAppAuth,
      auth: { appId: auth.appId, privateKey: auth.privateKey, installationId: auth.installationId },
    });
  }
  return new ThrottledOctokit({ ...common, auth: auth.token });
}

const split = (repo: string) => {
  const [owner = '', name = ''] = repo.split('/');
  return { owner, repo: name };
};

async function guard<T>(
  task: () => Promise<T>,
  notFoundAs?: () => ProviderResult<T>,
): Promise<ProviderResult<T>> {
  try {
    return ok(await task());
  } catch (e) {
    const error = classifyGitHubError(e);
    if (notFoundAs && error.classification === 'not-found') return notFoundAs();
    return fail<T>(error);
  }
}

class InvalidData extends Error {
  override readonly name = 'InvalidData';
  readonly status = 0;
}

export class GitHubProvider implements SourceProvider {
  readonly dataSource = 'github' as const;

  constructor(
    private readonly client: Client,
    readonly authenticationMode: AuthenticationMode,
  ) {}

  getRepository(repo: string): Promise<ProviderResult<RepositoryDTO>> {
    return guard(async () => {
      const { data } = await this.client.rest.repos.get(split(repo));
      return {
        owner: data.owner.login,
        name: data.name,
        fullName: data.full_name,
        htmlUrl: data.html_url,
        visibility:
          data.visibility === 'public' || data.visibility === 'internal'
            ? data.visibility
            : data.private
              ? 'private'
              : 'public',
        defaultBranch: data.default_branch,
        archived: data.archived,
        updatedAt: data.pushed_at ?? data.updated_at ?? null,
        topics: data.topics ?? [],
      };
    });
  }

  getBranchHead(repo: string, branch: string): Promise<ProviderResult<CommitRefDTO>> {
    return guard(async () => {
      const { data } = await this.client.rest.repos.getBranch({ ...split(repo), branch });
      return {
        sha: data.commit.sha,
        htmlUrl: data.commit.html_url ?? null,
        committedAt: data.commit.commit.committer?.date ?? null,
      };
    });
  }

  getLatestRelease(repo: string): Promise<ProviderResult<ReleaseDTO>> {
    return guard(async () => {
      const { data } = await this.client.rest.repos.getLatestRelease(split(repo));
      return {
        tagName: data.tag_name,
        name: data.name ?? null,
        publishedAt: data.published_at ?? null,
        prerelease: data.prerelease,
        htmlUrl: data.html_url,
      };
    });
  }

  getLatestTag(repo: string): Promise<ProviderResult<TagDTO>> {
    return guard(async () => {
      const { data } = await this.client.rest.repos.listTags({ ...split(repo), per_page: 1 });
      const tag = data[0];
      if (!tag) throw Object.assign(new Error('no tags'), { status: 404 });
      return { name: tag.name, sha: tag.commit.sha };
    });
  }

  getFile(repo: string, path: string, ref?: string): Promise<ProviderResult<FileDTO>> {
    return guard(async () => {
      const { data } = await this.client.rest.repos.getContent({
        ...split(repo),
        path,
        ...(ref ? { ref } : {}),
      });
      if (Array.isArray(data) || data.type !== 'file' || !('content' in data))
        throw new InvalidData('not a file');
      if (data.size > MAX_FILE_BYTES) throw new InvalidData('file too large');
      return { text: Buffer.from(data.content, 'base64').toString('utf8') };
    });
  }

  getSubmoduleRef(
    repo: string,
    path: string,
    ref?: string,
  ): Promise<ProviderResult<SubmoduleRefDTO>> {
    return guard(async () => {
      const { data } = await this.client.rest.repos.getContent({
        ...split(repo),
        path,
        ...(ref ? { ref } : {}),
      });
      if (Array.isArray(data) || data.type !== 'submodule')
        throw new InvalidData('not a submodule');
      return { path, sha: data.sha };
    });
  }

  listWorkflowRuns(
    repo: string,
    workflowFile: string,
    branch?: string,
  ): Promise<ProviderResult<WorkflowRunDTO[]>> {
    return guard(async () => {
      const { data } = await this.client.rest.actions.listWorkflowRuns({
        ...split(repo),
        workflow_id: workflowFile,
        ...(branch ? { branch } : {}),
        per_page: 20,
        exclude_pull_requests: true,
      });
      return data.workflow_runs.map((r) => ({
        id: r.id,
        runNumber: r.run_number,
        runAttempt: r.run_attempt ?? 1,
        status: r.status ?? 'unknown',
        conclusion: r.conclusion ?? null,
        headBranch: r.head_branch ?? null,
        event: r.event,
        headSha: r.head_sha ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        htmlUrl: r.html_url,
      }));
    });
  }

  getRunFailure(repo: string, runId: number): Promise<ProviderResult<RunFailureDTO | null>> {
    return guard(
      async () => {
        const { data } = await this.client.rest.actions.listJobsForWorkflowRun({
          ...split(repo),
          run_id: runId,
          filter: 'latest',
          per_page: 50,
        });
        const job = data.jobs.find(
          (j) => j.conclusion === 'failure' || j.conclusion === 'timed_out',
        );
        if (!job) return null;
        const step = job.steps?.find(
          (s) => s.conclusion === 'failure' || s.conclusion === 'timed_out',
        );
        return { jobName: job.name ?? null, stepName: step?.name ?? null };
      },
      () => ok(null),
    );
  }

  /** Reads at most MAX_ALERT_PAGES pages of 100 items. */
  private async paginate<T, R>(
    method: unknown,
    params: Record<string, unknown>,
    map: (item: T) => R,
  ): Promise<R[]> {
    const out: R[] = [];
    let pages = 0;
    const iterator = this.client.paginate.iterator as (
      m: unknown,
      p: unknown,
    ) => AsyncIterable<{ data: unknown }>;
    for await (const page of iterator(method, { ...params, per_page: 100 })) {
      for (const item of page.data as unknown as T[]) out.push(map(item));
      if (++pages >= MAX_ALERT_PAGES) break;
    }
    return out;
  }

  listCodeScanningAlerts(repo: string): Promise<ProviderResult<CodeScanningAlertDTO[]>> {
    type Alert = Awaited<
      ReturnType<Client['rest']['codeScanning']['listAlertsForRepo']>
    >['data'][number];
    return guard(() =>
      this.paginate<Alert, CodeScanningAlertDTO>(
        this.client.rest.codeScanning.listAlertsForRepo,
        split(repo),
        (a) => ({
          number: a.number,
          state: a.state ?? 'unknown',
          dismissedReason: a.dismissed_reason ?? null,
          ruleId: a.rule.id ?? null,
          ruleSeverity: a.rule.severity ?? null,
          securitySeverityLevel: a.rule.security_severity_level ?? null,
          ruleDescription: a.rule.description ?? null,
          toolName: a.tool.name ?? null,
          createdAt: a.created_at,
          updatedAt: a.updated_at ?? null,
          htmlUrl: a.html_url,
        }),
      ),
    );
  }

  getLatestCodeScanningAnalysis(
    repo: string,
  ): Promise<ProviderResult<CodeScanningAnalysisDTO | null>> {
    return guard(async () => {
      const { data } = await this.client.rest.codeScanning.listRecentAnalyses({
        ...split(repo),
        per_page: 1,
      });
      const a = data[0];
      return a ? { createdAt: a.created_at, toolName: a.tool.name ?? null } : null;
    });
  }

  listDependabotAlerts(repo: string): Promise<ProviderResult<DependabotAlertDTO[]>> {
    type Alert = Awaited<
      ReturnType<Client['rest']['dependabot']['listAlertsForRepo']>
    >['data'][number];
    return guard(() =>
      this.paginate<Alert, DependabotAlertDTO>(
        this.client.rest.dependabot.listAlertsForRepo,
        split(repo),
        (a) => ({
          number: a.number,
          state: a.state,
          dismissedReason: a.dismissed_reason ?? null,
          ghsaId: a.security_advisory.ghsa_id ?? null,
          cveId: a.security_advisory.cve_id ?? null,
          severity: a.security_vulnerability.severity ?? a.security_advisory.severity ?? null,
          summary: a.security_advisory.summary ?? null,
          packageName: a.dependency.package?.name ?? null,
          firstPatchedVersion: a.security_vulnerability.first_patched_version?.identifier ?? null,
          createdAt: a.created_at,
          updatedAt: a.updated_at,
          htmlUrl: a.html_url,
        }),
      ),
    );
  }

  listSecretScanningAlerts(repo: string): Promise<ProviderResult<SecretScanningAlertDTO[]>> {
    type Alert = Awaited<
      ReturnType<Client['rest']['secretScanning']['listAlertsForRepo']>
    >['data'][number];
    // hide_secret: the API must not even send the secret value. Only allow-listed fields are mapped.
    return guard(() =>
      this.paginate<Alert, SecretScanningAlertDTO>(
        this.client.rest.secretScanning.listAlertsForRepo,
        { ...split(repo), hide_secret: true },
        (a) => ({
          number: a.number ?? 0,
          state: a.state ?? 'unknown',
          resolution: a.resolution ?? null,
          secretTypeDisplayName: a.secret_type_display_name ?? null,
          createdAt: a.created_at ?? null,
          updatedAt: a.updated_at ?? null,
          htmlUrl: a.html_url ?? '',
        }),
      ),
    );
  }
}
