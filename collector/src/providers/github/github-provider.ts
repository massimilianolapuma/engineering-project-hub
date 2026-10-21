import { createAppAuth } from '@octokit/auth-app';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { Octokit } from '@octokit/rest';
import type { AuthenticationMode } from '@model/index';
import type { ResolvedAuth } from '../auth';
import {
  fail,
  ok,
  type CodeQualityFindingDTO,
  type CodeScanningAlertDTO,
  type CodeScanningAnalysisDTO,
  type CommitRefDTO,
  type CompareDTO,
  type DirectoryEntryDTO,
  type WorkflowDTO,
  type DependabotAlertDTO,
  type FileDTO,
  type ProviderResult,
  type QualitySummaryArtifactDTO,
  type ReleaseDTO,
  type RepositoryDTO,
  type RunFailureDTO,
  type SecretScanningAlertDTO,
  type SourceProvider,
  type SubmoduleRefDTO,
  type TagDTO,
  type WorkflowRunDTO,
} from '../types';
import { readZipEntry, ZipError } from '../../util/zip';
import { classifyGitHubError } from './errors';

const ThrottledOctokit = Octokit.plugin(throttling, retry);
type Client = InstanceType<typeof ThrottledOctokit>;

/** Max pages (100 items each) read per alert list and repository. Documented MVP limit. */
const MAX_ALERT_PAGES = 3;
/** Files above this size are not parsed (manifest / .gitmodules / status file are tiny). */
const MAX_FILE_BYTES = 256 * 1024;

/** Artifact name / file / size cap of the CI quality summary contract. */
const QUALITY_ARTIFACT = 'hub-quality-summary';
const QUALITY_FILE = 'quality-summary.json';
const ARTIFACT_PAGE_SIZE = 30;
const MAX_ARTIFACT_PAGES = 3;
const MAX_QUALITY_ZIP_BYTES = 65_536;
const CODE_QUALITY_API_VERSION = '2026-03-10';

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

/** More pages remain past MAX_ALERT_PAGES: the count would be incomplete (classified error). */
class FindingsPageCapExceeded extends Error {
  override readonly name = 'FindingsPageCapExceeded';
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

  listOwnerRepositories(
    owner: string,
    opts: { includePrivate: boolean; max: number },
  ): Promise<ProviderResult<RepositoryDTO[]>> {
    type Repo = Awaited<ReturnType<Client['rest']['repos']['listForUser']>>['data'][number];
    const map = (r: Repo): RepositoryDTO => ({
      owner: r.owner.login,
      name: r.name,
      fullName: r.full_name,
      htmlUrl: r.html_url,
      visibility: r.visibility === 'internal' ? 'internal' : r.private ? 'private' : 'public',
      defaultBranch: r.default_branch ?? 'main',
      archived: r.archived ?? false,
      updatedAt: r.pushed_at ?? r.updated_at ?? null,
      topics: r.topics ?? [],
      fork: r.fork,
    });
    return guard(async () => {
      const out: RepositoryDTO[] = [];
      const iterator = this.client.paginate.iterator as (
        m: unknown,
        p: unknown,
      ) => AsyncIterable<{ data: unknown }>;
      // Private repositories need the organisation endpoint (and the right permissions).
      const method = opts.includePrivate
        ? this.client.rest.repos.listForOrg
        : this.client.rest.repos.listForUser;
      const params = opts.includePrivate
        ? { org: owner, type: 'all', per_page: 100 }
        : { username: owner, type: 'owner', per_page: 100 };
      for await (const page of iterator(method, params)) {
        for (const r of page.data as Repo[]) {
          const dto = map(r);
          if (opts.includePrivate || dto.visibility === 'public') out.push(dto);
          if (out.length >= opts.max) return out;
        }
      }
      return out;
    });
  }

  listDirectory(repo: string, path: string): Promise<ProviderResult<DirectoryEntryDTO[]>> {
    return guard(async () => {
      const { data } = await this.client.rest.repos.getContent({ ...split(repo), path });
      if (!Array.isArray(data)) throw new InvalidData('not a directory');
      return data.map((e) => ({ name: e.name, type: e.type as DirectoryEntryDTO['type'] }));
    });
  }

  listWorkflows(repo: string): Promise<ProviderResult<WorkflowDTO[]>> {
    return guard(async () => {
      const { data } = await this.client.rest.actions.listRepoWorkflows({
        ...split(repo),
        per_page: 100,
      });
      return data.workflows
        .filter((w) => w.path.startsWith('.github/workflows/'))
        .map((w) => ({ file: w.path.split('/').pop() ?? w.path, name: w.name }));
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

  listTags(repo: string): Promise<ProviderResult<TagDTO[]>> {
    type Tag = Awaited<ReturnType<Client['rest']['repos']['listTags']>>['data'][number];
    return guard(() =>
      this.paginate<Tag, TagDTO>(this.client.rest.repos.listTags, split(repo), (t) => ({
        name: t.name,
        sha: t.commit.sha,
      })),
    );
  }

  compareCommits(repo: string, base: string, head: string): Promise<ProviderResult<CompareDTO>> {
    return guard(async () => {
      // per_page=1: only the status and counters are used, never the commits or files.
      const { data } = await this.client.rest.repos.compareCommitsWithBasehead({
        ...split(repo),
        basehead: `${base}...${head}`,
        per_page: 1,
      });
      return { status: data.status, aheadBy: data.ahead_by, behindBy: data.behind_by };
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

  /**
   * Reads at most MAX_ALERT_PAGES pages of 100 items. With `failWhenCapped`, hitting the cap
   * while more pages remain throws instead of returning a partial list (a count must never
   * read as complete when it is not).
   */
  private async paginate<T, R>(
    method: unknown,
    params: Record<string, unknown>,
    map: (item: T) => R,
    opts: { failWhenCapped?: boolean } = {},
  ): Promise<R[]> {
    const out: R[] = [];
    let pages = 0;
    const iterator = this.client.paginate.iterator as (
      m: unknown,
      p: unknown,
    ) => AsyncIterable<{ data: unknown; headers?: { link?: string } }>;
    for await (const page of iterator(method, { ...params, per_page: 100 })) {
      for (const item of page.data as unknown as T[]) out.push(map(item));
      if (++pages >= MAX_ALERT_PAGES) {
        if (opts.failWhenCapped && /rel="next"/.test(page.headers?.link ?? ''))
          throw new FindingsPageCapExceeded();
        break;
      }
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
          path: a.most_recent_instance?.location?.path ?? null,
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
          manifestPath: a.dependency.manifest_path ?? null,
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

  getQualitySummary(
    repo: string,
    branch: string,
  ): Promise<ProviderResult<QualitySummaryArtifactDTO>> {
    const { owner, repo: name } = split(repo);
    return guard(async () => {
      type Art = Awaited<
        ReturnType<Client['rest']['actions']['listArtifactsForRepo']>
      >['data']['artifacts'][number];
      // Only same-repository runs on the branch are trusted: a fork PR run can share the
      // branch name but has a different head repository.
      const trusted = (a: Art) =>
        a.workflow_run?.head_branch === branch &&
        a.workflow_run.head_repository_id != null &&
        a.workflow_run.head_repository_id === a.workflow_run.repository_id;
      const runUrlOf = (a: Art) =>
        a.workflow_run?.id != null
          ? `https://github.com/${owner}/${name}/actions/runs/${a.workflow_run.id}`
          : null;
      let live: Art | undefined;
      let newestExpired: Art | undefined;
      for (let page = 1; page <= MAX_ARTIFACT_PAGES && !live; page++) {
        const { data } = await this.client.rest.actions.listArtifactsForRepo({
          owner,
          repo: name,
          name: QUALITY_ARTIFACT,
          per_page: ARTIFACT_PAGE_SIZE,
          page,
        });
        const matching = data.artifacts
          .filter(trusted)
          .sort((x, y) => Date.parse(y.created_at ?? '') - Date.parse(x.created_at ?? ''));
        live = matching.find((a) => !a.expired);
        newestExpired ??= matching[0];
        if (data.artifacts.length < ARTIFACT_PAGE_SIZE) break;
      }
      if (!live) {
        if (!newestExpired) throw Object.assign(new Error('no artifact'), { status: 404 });
        return {
          summaryText: null,
          createdAt: newestExpired.created_at ?? null,
          runUrl: runUrlOf(newestExpired),
        };
      }
      if (live.size_in_bytes > MAX_QUALITY_ZIP_BYTES) throw new InvalidData('artifact too large');
      const res = await this.client.rest.actions.downloadArtifact({
        owner,
        repo: name,
        artifact_id: live.id,
        archive_format: 'zip',
      });
      const bytes = new Uint8Array(res.data as ArrayBuffer);
      if (bytes.byteLength > MAX_QUALITY_ZIP_BYTES) throw new InvalidData('artifact too large');
      try {
        return {
          summaryText: readZipEntry(bytes, QUALITY_FILE, MAX_QUALITY_ZIP_BYTES),
          createdAt: live.created_at ?? null,
          runUrl: runUrlOf(live),
        };
      } catch (e) {
        if (e instanceof ZipError) throw new InvalidData('invalid artifact archive');
        throw e;
      }
    });
  }

  listCodeQualityFindings(repo: string): Promise<ProviderResult<CodeQualityFindingDTO[]>> {
    type Finding = { rule?: { category?: string | null; severity?: string | null } | null };
    return guard(() =>
      this.paginate<Finding, CodeQualityFindingDTO>(
        'GET /repos/{owner}/{repo}/code-quality/findings',
        {
          ...split(repo),
          state: 'open',
          headers: { 'X-GitHub-Api-Version': CODE_QUALITY_API_VERSION },
        },
        (f) => ({
          category: f.rule?.category ?? 'unknown',
          severity: f.rule?.severity ?? 'unknown',
        }),
        // Past 300 findings the repository's count is unknown, never under-counted.
        { failWhenCapped: true },
      ),
    );
  }
}
