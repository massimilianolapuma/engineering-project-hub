import { createAppAuth } from '@octokit/auth-app';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { Octokit } from '@octokit/rest';
import type { AuthenticationMode } from '@model/index';
import type { ResolvedAuth } from '../auth';
import {
  fail,
  ok,
  type BranchRuleDTO,
  type ClassicProtectionDTO,
  type CodeQualityFindingDTO,
  type CustomPropertyDTO,
  type CodeScanningAlertDTO,
  type AttestationPresenceDTO,
  type CodeScanningAnalysisDTO,
  type CommitRefDTO,
  type CompareDTO,
  type DirectoryEntryDTO,
  type WorkflowDTO,
  type DependabotAlertDTO,
  type PathCommitDTO,
  type EnvironmentDTO,
  type FileDTO,
  type ProviderResult,
  type TeamDTO,
  type TeamPermission,
  type TeamRepositoryDTO,
  type QualitySummaryArtifactDTO,
  type ReleaseDTO,
  type RepositoryDTO,
  type SbomFetchDTO,
  type SbomRequestDTO,
  type RunFailureDTO,
  type SecretScanningAlertDTO,
  type SourceProvider,
  type SubmoduleRefDTO,
  type SupplyChainSummaryArtifactDTO,
  type TagDTO,
  type WorkflowRunDTO,
  WORKFLOW_FILE,
} from '../types';
import { DownloadError, downloadBounded } from '../../util/bounded-fetch';
import { readZipEntry, ZipError } from '../../util/zip';
import { classifyGitHubError, type ClassifyOptions } from './errors';

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
/** Artifact name / file / size cap of the CI supply-chain summary contract. */
const SUPPLY_CHAIN_ARTIFACT = 'hub-supply-chain-summary';
const SUPPLY_CHAIN_FILE = 'supply-chain-summary.json';
const MAX_SUPPLY_CHAIN_ZIP_BYTES = 65_536;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const ANALYSES_PER_PAGE = 10;
const CODE_QUALITY_API_VERSION = '2026-03-10';

/** Version header of the SBOM export (and attestations) endpoints. */
const SBOM_API_VERSION = '2026-03-10';
/**
 * The 302 target of the SBOM report is not documented: exact host or `.`-suffix match, anything
 * else fails closed (the observed host is recorded in docs/security.md).
 */
export const SBOM_DOWNLOAD_HOST_SUFFIXES = ['githubusercontent.com', 'github.com'] as const;
const SBOM_UUID = /^[0-9a-fA-F-]{36}$/;
/** "Dependency graph …" in a 403/404 means not set up, but only on the SBOM export calls. */
const SBOM_ERRORS: ClassifyOptions = { notConfigured: /dependency graph/i };
const SBOM_REPORT_URL = /\/dependency-graph\/sbom\/fetch-report\/([0-9a-fA-F-]{36})$/;
const SBOM_DOWNLOAD_TIMEOUT_MS = 20_000;
const DEFAULT_SBOM_MAX_BYTES = 16 * 1024 * 1024;

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

/** Pages of 100 runs read for the control map delivery workflow (500 runs in the window). */
export const MAX_DELIVERY_RUN_PAGES = 5;

type RawRun = Awaited<
  ReturnType<Client['rest']['actions']['listWorkflowRuns']>
>['data']['workflow_runs'][number];

const toRunDTO = (r: RawRun): WorkflowRunDTO => ({
  id: r.id,
  runNumber: r.run_number,
  runAttempt: r.run_attempt ?? 1,
  status: r.status ?? 'unknown',
  conclusion: r.conclusion ?? null,
  headBranch: r.head_branch ?? null,
  event: r.event,
  headSha: r.head_sha ?? null,
  headCommitAt: r.head_commit?.timestamp ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  htmlUrl: r.html_url,
});

/** security_and_analysis is only returned to callers allowed to see it: absent → null. */
function pushProtectionOf(data: {
  security_and_analysis?: {
    secret_scanning_push_protection?: { status?: string } | null;
  } | null;
}): 'enabled' | 'disabled' | null {
  const status = data.security_and_analysis?.secret_scanning_push_protection?.status;
  return status === 'enabled' || status === 'disabled' ? status : null;
}

async function guard<T>(
  task: () => Promise<T>,
  notFoundAs?: () => ProviderResult<T>,
  classify?: ClassifyOptions,
): Promise<ProviderResult<T>> {
  try {
    return ok(await task());
  } catch (e) {
    const error = classifyGitHubError(e, classify);
    if (e instanceof FindingsPageCapExceeded) error.incomplete = true;
    if (notFoundAs && error.classification === 'not-found') return notFoundAs();
    return fail<T>(error);
  }
}

const ROLE_NAMES: Record<string, TeamPermission> = {
  pull: 'read',
  read: 'read',
  triage: 'triage',
  push: 'write',
  write: 'write',
  maintain: 'maintain',
  admin: 'admin',
};

/** A team's permission: role_name when present, else the highest true `permissions` key. */
function teamPermission(r: {
  role_name?: string;
  permissions?: Partial<Record<'admin' | 'maintain' | 'push' | 'triage' | 'pull', boolean>>;
}): TeamPermission | null {
  const byRole = r.role_name ? ROLE_NAMES[r.role_name] : undefined;
  if (byRole) return byRole;
  const p = r.permissions;
  if (!p) return null;
  if (p.admin) return 'admin';
  if (p.maintain) return 'maintain';
  if (p.push) return 'write';
  if (p.triage) return 'triage';
  if (p.pull) return 'read';
  return null;
}

class InvalidData extends Error {
  override readonly name = 'InvalidData';
  readonly status = 0;
}

/** More pages remain past MAX_ALERT_PAGES: the count would be incomplete (classified error). */
class FindingsPageCapExceeded extends Error {
  override readonly name = 'FindingsPageCapExceeded';
}

export interface GitHubProviderOptions {
  /**
   * Owner opt-in (policies.supplyChain.sbom.dependencyGraph, default false). Only when true may
   * `requestDependencySbom` call generate-report, the one call that asks GitHub to run a job.
   */
  dependencyGraphExport?: boolean;
  /** Streaming byte cap of the SBOM download (policies.supplyChain.sbom.maxBytes). */
  sbomMaxBytes?: number;
  /** Injected in tests: used for the SBOM download link, which never gets the credential. */
  fetch?: typeof globalThis.fetch;
}

export class GitHubProvider implements SourceProvider {
  readonly dataSource = 'github' as const;
  readonly dependencyGraphExport: boolean;

  constructor(
    private readonly client: Client,
    readonly authenticationMode: AuthenticationMode,
    private readonly options: GitHubProviderOptions = {},
  ) {
    this.dependencyGraphExport = options.dependencyGraphExport === true;
  }

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
        pushProtection: pushProtectionOf(data),
      };
    });
  }

  listEnvironments(repo: string): Promise<ProviderResult<EnvironmentDTO[]>> {
    return guard(async () => {
      const { data } = await this.client.rest.repos.getAllEnvironments({
        ...split(repo),
        per_page: 100,
      });
      return (data.environments ?? []).map((e) => ({
        name: e.name,
        protected: (e.protection_rules ?? []).some(
          (r) => r.type === 'required_reviewers' || r.type === 'wait_timer',
        ),
        branchPolicy: e.deployment_branch_policy != null,
      }));
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

  listOrgTeams(
    org: string,
    opts: { max: number },
  ): Promise<ProviderResult<{ teams: TeamDTO[]; limitReached: boolean }>> {
    type Team = { slug: string; name: string; privacy?: string };
    return guard(async () => {
      const teams: TeamDTO[] = [];
      const iterator = this.client.paginate.iterator as (
        m: unknown,
        p: unknown,
      ) => AsyncIterable<{ data: unknown }>;
      for await (const page of iterator(this.client.rest.teams.list, { org, per_page: 100 })) {
        for (const t of page.data as Team[]) {
          // One more team than allowed: the list is cut, never silently complete.
          if (teams.length >= opts.max) return { teams, limitReached: true };
          teams.push({
            org,
            slug: t.slug,
            name: t.name,
            privacy: t.privacy === 'secret' ? 'secret' : 'closed',
          });
        }
      }
      return { teams, limitReached: false };
    });
  }

  listTeamRepositories(
    org: string,
    teamSlug: string,
  ): Promise<ProviderResult<TeamRepositoryDTO[]>> {
    type Repo = {
      full_name: string;
      role_name?: string;
      permissions?: Partial<Record<'admin' | 'maintain' | 'push' | 'triage' | 'pull', boolean>>;
    };
    return guard(async () =>
      this.paginate<Repo, TeamRepositoryDTO>(
        this.client.rest.teams.listReposInOrg,
        { org, team_slug: teamSlug },
        (r) => ({ fullName: r.full_name, permission: teamPermission(r) }),
        { failWhenCapped: true },
      ),
    );
  }

  listDirectory(
    repo: string,
    path: string,
    ref?: string,
  ): Promise<ProviderResult<DirectoryEntryDTO[]>> {
    return guard(async () => {
      const { data } = await this.client.rest.repos.getContent({
        ...split(repo),
        path,
        ...(ref ? { ref } : {}),
      });
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
        protected: data.protected ?? null,
      };
    });
  }

  getBranchRules(repo: string, branch: string): Promise<ProviderResult<BranchRuleDTO[]>> {
    type Rule = { type: string; parameters?: { required_approving_review_count?: number } | null };
    return guard(async () => {
      const { data } = await this.client.request(
        'GET /repos/{owner}/{repo}/rules/branches/{branch}',
        {
          ...split(repo),
          branch,
          per_page: 100,
        },
      );
      return (data as unknown as Rule[]).map((r) => ({
        type: r.type,
        requiredApprovals:
          r.type === 'pull_request'
            ? (r.parameters?.required_approving_review_count ?? null)
            : null,
      }));
    });
  }

  getClassicBranchProtection(
    repo: string,
    branch: string,
  ): Promise<ProviderResult<ClassicProtectionDTO | null>> {
    return guard(
      async () => {
        const { data } = await this.client.rest.repos.getBranchProtection({
          ...split(repo),
          branch,
        });
        return {
          pullRequestReviews: !!data.required_pull_request_reviews,
          requiredApprovals:
            data.required_pull_request_reviews?.required_approving_review_count ?? null,
          statusChecks: !!data.required_status_checks,
          forcePushBlocked: data.allow_force_pushes?.enabled === false,
          deletionBlocked: data.allow_deletions?.enabled === false,
        };
      },
      () => ok(null),
    );
  }

  getLatestScorecardAnalysis(
    repo: string,
  ): Promise<ProviderResult<CodeScanningAnalysisDTO | null>> {
    return guard(
      async () => {
        const { data } = await this.client.rest.codeScanning.listRecentAnalyses({
          ...split(repo),
          tool_name: 'Scorecard',
          per_page: 1,
        });
        const a = data[0];
        return a ? { createdAt: a.created_at, toolName: a.tool.name ?? null } : null;
      },
      () => ok(null),
    );
  }

  getCustomPropertyValues(repo: string): Promise<ProviderResult<CustomPropertyDTO[]>> {
    type Value = { property_name: string; value: string | string[] | null };
    return guard(async () => {
      const { data } = await this.client.request('GET /repos/{owner}/{repo}/properties/values', {
        ...split(repo),
      });
      return (data as unknown as Value[]).map((v) => ({
        name: v.property_name,
        value: v.value ?? null,
      }));
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
        // Name and digest only: GitHub reports the digest as "sha256:<hex>" or null.
        assets: (data.assets ?? []).map((a) => ({
          name: a.name,
          digest: typeof a.digest === 'string' && SHA256_DIGEST.test(a.digest) ? a.digest : null,
        })),
      };
    });
  }

  listCommitsForPath(repo: string, path: string): Promise<ProviderResult<PathCommitDTO[]>> {
    return guard(async () => {
      const { data } = await this.client.rest.repos.listCommits({
        ...split(repo),
        path,
        per_page: 100,
      });
      return data.map((c) => ({
        sha: c.sha,
        committedAt: c.commit.committer?.date ?? c.commit.author?.date ?? null,
      }));
    });
  }

  listReleases(repo: string): Promise<ProviderResult<ReleaseDTO[]>> {
    return guard(async () => {
      const { data } = await this.client.rest.repos.listReleases({ ...split(repo), per_page: 100 });
      return data
        .filter((r) => !r.draft)
        .map((r) => ({
          tagName: r.tag_name,
          name: r.name ?? null,
          publishedAt: r.published_at ?? null,
          prerelease: r.prerelease,
          htmlUrl: r.html_url,
          assets: [],
        }));
    });
  }

  getCommitDate(repo: string, ref: string): Promise<ProviderResult<string | null>> {
    return guard(async () => {
      const { data } = await this.client.rest.repos.getCommit({ ...split(repo), ref });
      return data.commit.committer?.date ?? data.commit.author?.date ?? null;
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
      // Defence in depth: only a plain workflow file name below .github/workflows/ is readable.
      if (path.startsWith('.github/workflows/') && !WORKFLOW_FILE.test(path.slice(18)))
        throw new InvalidData('workflow path not allowed');
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
      return data.workflow_runs.map(toRunDTO);
    });
  }

  listWorkflowRunsSince(
    repo: string,
    workflowFile: string,
    since: string,
  ): Promise<ProviderResult<{ runs: WorkflowRunDTO[]; truncated: boolean }>> {
    return guard(async () => {
      const runs: WorkflowRunDTO[] = [];
      let truncated = false;
      for (let page = 1; page <= MAX_DELIVERY_RUN_PAGES; page++) {
        const { data } = await this.client.rest.actions.listWorkflowRuns({
          ...split(repo),
          workflow_id: workflowFile,
          created: `>=${since}`,
          per_page: 100,
          page,
          exclude_pull_requests: true,
        });
        runs.push(...data.workflow_runs.map(toRunDTO));
        if (data.workflow_runs.length < 100 || runs.length >= data.total_count) break;
        if (page === MAX_DELIVERY_RUN_PAGES) truncated = true;
      }
      return { runs, truncated };
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
          category: a.most_recent_instance?.category ?? null,
          createdAt: a.created_at,
          updatedAt: a.updated_at ?? null,
          resolvedAt: a.fixed_at ?? a.dismissed_at ?? null,
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
          resolvedAt: a.fixed_at ?? a.dismissed_at ?? a.auto_dismissed_at ?? null,
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
          resolvedAt: a.resolved_at ?? null,
          htmlUrl: a.html_url ?? '',
        }),
      ),
    );
  }

  getQualitySummary(
    repo: string,
    branch: string,
  ): Promise<ProviderResult<QualitySummaryArtifactDTO>> {
    return this.getSummaryArtifact(repo, branch, {
      artifact: QUALITY_ARTIFACT,
      file: QUALITY_FILE,
      maxBytes: MAX_QUALITY_ZIP_BYTES,
    });
  }

  getSupplyChainSummary(
    repo: string,
    branch: string,
  ): Promise<ProviderResult<SupplyChainSummaryArtifactDTO>> {
    return this.getSummaryArtifact(repo, branch, {
      artifact: SUPPLY_CHAIN_ARTIFACT,
      file: SUPPLY_CHAIN_FILE,
      maxBytes: MAX_SUPPLY_CHAIN_ZIP_BYTES,
    });
  }

  /**
   * Newest non-expired artifact `artifact` of a same-repository run on `branch`, unzipped to the
   * text of its single `file`. The size is checked before and after the download.
   */
  private getSummaryArtifact(
    repo: string,
    branch: string,
    spec: { artifact: string; file: string; maxBytes: number },
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
          name: spec.artifact,
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
      if (live.size_in_bytes > spec.maxBytes) throw new InvalidData('artifact too large');
      const res = await this.client.rest.actions.downloadArtifact({
        owner,
        repo: name,
        artifact_id: live.id,
        archive_format: 'zip',
      });
      const bytes = new Uint8Array(res.data as ArrayBuffer);
      if (bytes.byteLength > spec.maxBytes) throw new InvalidData('artifact too large');
      try {
        return {
          summaryText: readZipEntry(bytes, spec.file, spec.maxBytes),
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

  listCodeScanningAnalyses(
    repo: string,
    tool: string,
    ref: string,
  ): Promise<ProviderResult<CodeScanningAnalysisDTO[]>> {
    return guard(
      async () => {
        const { data } = await this.client.rest.codeScanning.listRecentAnalyses({
          ...split(repo),
          tool_name: tool,
          ref: ref.startsWith('refs/') ? ref : `refs/heads/${ref}`,
          per_page: ANALYSES_PER_PAGE,
        });
        return data.map((a) => ({
          createdAt: a.created_at,
          toolName: a.tool.name ?? null,
          category: a.category ?? null,
        }));
      },
      () => ok([]),
    );
  }

  getAttestationPresence(
    repo: string,
    digest: string,
  ): Promise<ProviderResult<AttestationPresenceDTO>> {
    return guard(async () => {
      // The digest is a path segment: only the exact documented shape is ever sent.
      if (!SHA256_DIGEST.test(digest)) throw new InvalidData('invalid digest');
      const has = async (predicate: 'provenance' | 'sbom'): Promise<boolean> => {
        try {
          const { data } = await this.client.request(
            'GET /repos/{owner}/{repo}/attestations/{subject_digest}',
            {
              ...split(repo),
              subject_digest: digest,
              predicate_type: predicate,
              per_page: 1,
              headers: { 'X-GitHub-Api-Version': SBOM_API_VERSION },
            },
          );
          // Only the count is read: the bundle is never copied anywhere.
          const list = (data as { attestations?: unknown } | null)?.attestations;
          return Array.isArray(list) && list.length > 0;
        } catch (e) {
          // The endpoint answers 404 when nothing matches.
          if ((e as { status?: number } | null)?.status === 404) return false;
          throw e;
        }
      };
      return { provenance: await has('provenance'), sbom: await has('sbom') };
    });
  }

  requestDependencySbom(repo: string): Promise<ProviderResult<SbomRequestDTO>> {
    // Gate of the single "compute" call (ADR 0011): without the owner's opt-in nothing is sent.
    if (!this.dependencyGraphExport)
      return Promise.resolve(
        fail({
          classification: 'not-configured',
          message: 'dependency-graph SBOM export is off',
          skipped: true,
        }),
      );
    return guard(
      async () => {
        const { data } = await this.client.request(
          'GET /repos/{owner}/{repo}/dependency-graph/sbom/generate-report',
          { ...split(repo), headers: { 'X-GitHub-Api-Version': SBOM_API_VERSION } },
        );
        // The report URL is never called: only the uuid is kept, and only from the expected path.
        const url = (data as { sbom_url?: unknown } | null)?.sbom_url;
        const uuid = typeof url === 'string' ? SBOM_REPORT_URL.exec(url)?.[1] : undefined;
        if (!uuid) throw new InvalidData('unexpected sbom_url');
        return { uuid };
      },
      undefined,
      SBOM_ERRORS,
    );
  }

  async fetchDependencySbom(repo: string, uuid: string): Promise<ProviderResult<SbomFetchDTO>> {
    const step = await guard(
      async () => {
        if (!SBOM_UUID.test(uuid)) throw new InvalidData('invalid report id');
        const res = await this.client.request(
          'GET /repos/{owner}/{repo}/dependency-graph/sbom/fetch-report/{sbom_uuid}',
          {
            ...split(repo),
            sbom_uuid: uuid,
            headers: { 'X-GitHub-Api-Version': SBOM_API_VERSION },
            // The temporary download link is read from the Location header, never followed here.
            request: { redirect: 'manual' },
          },
        );
        // Octokit types this route as 302 only; 202 (still generating) is documented.
        const status: number = res.status;
        if (status === 202) return { pending: true as const };
        const location = (res.headers as Record<string, string | undefined>).location;
        if (status !== 302 || !location) throw new InvalidData('unexpected SBOM response');
        return { pending: false as const, location };
      },
      undefined,
      SBOM_ERRORS,
    );
    if (!step.ok) return step;
    if (step.data.pending) return ok({ state: 'pending' });
    try {
      const text = await downloadBounded(step.data.location, {
        allowedHostSuffixes: SBOM_DOWNLOAD_HOST_SUFFIXES,
        maxBytes: this.options.sbomMaxBytes ?? DEFAULT_SBOM_MAX_BYTES,
        timeoutMs: SBOM_DOWNLOAD_TIMEOUT_MS,
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      });
      return ok({ state: 'ready', text });
    } catch (e) {
      if (!(e instanceof DownloadError)) throw e;
      if (e.kind === 'host')
        return fail({ classification: 'invalid-data', message: 'SBOM download host not allowed' });
      if (e.kind === 'too-large')
        return fail({
          classification: 'invalid-data',
          message: 'SBOM too large',
          incomplete: true,
        });
      return fail({ classification: 'error', message: 'SBOM download failed' });
    }
  }
}
