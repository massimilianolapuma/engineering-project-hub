import {
  projectTargets,
  type Policies,
  type ProjectConfig,
  type TrackedWorkflowConfig,
} from '@model/index';
import type {
  ArgoApplicationDTO,
  HarborArtifactDTO,
  SonarProjectDTO,
} from '../providers/external/types';
import { associateSubmodules } from '../normalizers/association';
import { exactIdentifier } from '../sanitizers/sanitize';
import { memoize } from '../util/concurrency';
import { parseGitmodules, type GitmoduleEntry } from '../util/gitmodules';
import type { TargetVersions } from '../normalizers/workflow-refs';
import {
  fail,
  MAX_WORKFLOW_FILE_NAME,
  WORKFLOW_FILE,
  type BranchRuleDTO,
  type ClassicProtectionDTO,
  type CodeQualityFindingDTO,
  type AttestationPresenceDTO,
  type CodeScanningAlertDTO,
  type CodeScanningAnalysisDTO,
  type CommitRefDTO,
  type CompareDTO,
  type DependabotAlertDTO,
  type DirectoryEntryDTO,
  type FileDTO,
  type ProviderResult,
  type QualitySummaryArtifactDTO,
  type ReleaseDTO,
  type RunFailureDTO,
  type SbomFetchDTO,
  type SbomRequestDTO,
  type SupplyChainSummaryArtifactDTO,
  type RepositoryDTO,
  type SecretScanningAlertDTO,
  type SourceProvider,
  type SubmoduleRefDTO,
  type TagDTO,
  type WorkflowRunDTO,
} from '../providers/types';

export const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);
/** Conclusions that say nothing about the health of the code (run never really executed). */
const NON_INFORMATIVE_CONCLUSIONS = new Set(['action_required', 'stale', 'skipped']);

/**
 * Runs that describe the default branch itself: pull-request runs are excluded (fork PRs
 * report head_branch "main" too), newest first.
 */
export function branchRuns(runs: WorkflowRunDTO[]): WorkflowRunDTO[] {
  return runs
    .filter((r) => !r.event.startsWith('pull_request'))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** Most recent completed run with an informative conclusion. */
export function lastCompletedRun(runs: WorkflowRunDTO[]): WorkflowRunDTO | undefined {
  return runs.find(
    (r) => r.status === 'completed' && !NON_INFORMATIVE_CONCLUSIONS.has(r.conclusion ?? ''),
  );
}

/** Raw repository-controls data of one repository (workflow files are parsed and dropped later). */
export interface RepoControlsData {
  /** `.github/workflows` listing at the branch; a 404 means "no workflows". */
  workflowDir: ProviderResult<DirectoryEntryDTO[]>;
  /** Workflow file text by file name (the first `maxWorkflowFiles`, sorted). Never published. */
  workflowFiles: Map<string, ProviderResult<FileDTO>>;
  /** Workflow files left unread: over `maxWorkflowFiles`, or a name over 100 characters. */
  omittedFiles: number;
  rules: ProviderResult<BranchRuleDTO[]>;
  /** null = not read (readClassicProtection is off). */
  classic: ProviderResult<ClassicProtectionDTO | null> | null;
  scorecardAnalysis: ProviderResult<CodeScanningAnalysisDTO | null>;
}

/** Everything collected for one repository, still provider-neutral and unevaluated. */
export interface RepoData {
  componentId: string;
  repository: string;
  configuredDefaultBranch: string | null;
  branch: string | null;
  repo: ProviderResult<RepositoryDTO>;
  head: ProviderResult<CommitRefDTO>;
  release: ProviderResult<ReleaseDTO>;
  tag: ProviderResult<TagDTO> | null;
  securityStatusFile: ProviderResult<FileDTO>;
  codeScanning: ProviderResult<CodeScanningAlertDTO[]>;
  codeScanningAnalysis: ProviderResult<CodeScanningAnalysisDTO | null>;
  dependabot: ProviderResult<DependabotAlertDTO[]>;
  secretScanning: ProviderResult<SecretScanningAlertDTO[]>;
  /** Newest default-branch `hub-quality-summary` artifact. */
  qualitySummary: ProviderResult<QualitySummaryArtifactDTO>;
  codeQualityFindings: ProviderResult<CodeQualityFindingDTO[]>;
  /** Result of asking GitHub for the SBOM export; null = not requested (switch off, or skipped). */
  sbomRequest: ProviderResult<SbomRequestDTO> | null;
  /** Last answer of the export poll; null when nothing was requested or the request failed. */
  sbomFetch: ProviderResult<SbomFetchDTO> | null;
  /** Attestation presence per release-asset digest; 'skipped' = not looked up. */
  attestations: Map<string, ProviderResult<AttestationPresenceDTO>> | 'skipped';
  /** Code-scanning analyses by lower-case tool name of the mapped tools (policies toolControls). */
  analyses: Map<string, ProviderResult<CodeScanningAnalysisDTO[]>>;
  /** Newest `hub-supply-chain-summary` artifact; null when supplyChain.enabled is false. */
  supplyChainSummary: ProviderResult<SupplyChainSummaryArtifactDTO> | null;
  /** null when policies.repositoryControls.enabled is false: none of its calls is made. */
  controls: RepoControlsData | null;
}

export interface WorkflowData {
  workflow: TrackedWorkflowConfig;
  componentId: string;
  repository: string;
  branch: string | null;
  runs: ProviderResult<WorkflowRunDTO[]>;
  /** Failed job/step of the most recent failed run, when the latest completed run failed. */
  failure: ProviderResult<RunFailureDTO | null> | null;
}

/** Data used to resolve the SHA a coordinator pins for a component into a version. */
export interface PinData {
  componentId: string;
  sha: string;
  /** Component tags (name + commit SHA), newest first. */
  tags: ProviderResult<TagDTO[]>;
  /** Latest release tag vs the pinned SHA, only when no tag matches the SHA. */
  compareBase: string | null;
  compare: ProviderResult<CompareDTO> | null;
}

export interface RawProjectData {
  config: ProjectConfig;
  repos: RepoData[];
  manifest: ProviderResult<FileDTO>;
  gitmodules: ProviderResult<FileDTO>;
  submodules: GitmoduleEntry[];
  submoduleRefs: Map<string, ProviderResult<SubmoduleRefDTO>>;
  pins: PinData[];
  /** Tags of repositories whose components use a releaseTagPrefix (monorepos), by component. */
  componentTags: Map<string, ProviderResult<TagDTO[]>>;
  workflows: WorkflowData[];
  /** SonarQube projects by project key; absent or empty when SonarQube is off. */
  sonar?: Map<string, ProviderResult<SonarProjectDTO>>;
  /** Harbor artifacts by `project/repository:reference`; absent or empty when Harbor is off. */
  harbor?: Map<string, ProviderResult<HarborArtifactDTO>>;
  /** Tags of the coordinator repository (resolve an Argo CD revision to a version); null = not read. */
  coordinatorTags?: ProviderResult<TagDTO[]> | null;
  /** Argo CD applications by environment id ('off' when Argo CD is off). */
  argocd?: Map<string, ProviderResult<ArgoApplicationDTO> | 'off'>;
}

export interface CollectContext {
  provider: SourceProvider;
  limit: <T>(task: () => Promise<T>) => Promise<T>;
  /** Shared across projects: one fetch per repository and call. */
  cache: Map<string, Promise<unknown>>;
  policies: Policies;
  /** Waits between SBOM export polls (default: a real timer; tests and mock runs pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

/** Runs a provider call through the limiter; unexpected exceptions become classified errors. */
async function call<T>(
  ctx: CollectContext,
  key: string,
  task: () => Promise<ProviderResult<T>>,
): Promise<ProviderResult<T>> {
  return memoize(ctx.cache as Map<string, Promise<ProviderResult<T>>>, key, () =>
    ctx.limit(async () => {
      try {
        return await task();
      } catch (e) {
        return fail<T>({ classification: 'error', message: (e as Error)?.name ?? 'Error' });
      }
    }),
  );
}

function skipped<T>(repo: ProviderResult<RepositoryDTO>): ProviderResult<T> {
  // Repository metadata failed, so dependent calls are not made. A 404 on the repository must
  // not read as "workflow / file / release absent": keep only "not authorised" vs "error".
  const classification =
    !repo.ok && repo.error.classification === 'not-authorised' ? 'not-authorised' : 'error';
  return fail({ classification, message: 'repository not accessible', skipped: true });
}

export async function collectRepository(
  ctx: CollectContext,
  componentId: string,
  repository: string,
  configuredDefaultBranch: string | null,
  securityStatusPath: string,
): Promise<RepoData> {
  const p = ctx.provider;
  const repo = await call(ctx, `repo:${repository}`, () => p.getRepository(repository));
  if (!repo.ok) {
    return {
      componentId,
      repository,
      configuredDefaultBranch,
      branch: configuredDefaultBranch,
      repo,
      head: skipped(repo),
      release: skipped(repo),
      tag: null,
      securityStatusFile: skipped(repo),
      codeScanning: skipped(repo),
      codeScanningAnalysis: skipped(repo),
      dependabot: skipped(repo),
      secretScanning: skipped(repo),
      qualitySummary: skipped(repo),
      codeQualityFindings: skipped(repo),
      sbomRequest: null,
      sbomFetch: null,
      attestations: 'skipped',
      analyses: new Map(),
      supplyChainSummary: ctx.policies.supplyChain.enabled ? skipped(repo) : null,
      controls: ctx.policies.repositoryControls.enabled
        ? {
            workflowDir: skipped(repo),
            workflowFiles: new Map(),
            omittedFiles: 0,
            rules: skipped(repo),
            classic: ctx.policies.repositoryControls.readClassicProtection ? skipped(repo) : null,
            scorecardAnalysis: skipped(repo),
          }
        : null,
    };
  }
  const branch = configuredDefaultBranch ?? repo.data.defaultBranch;
  const sc = ctx.policies.supplyChain;
  // The SBOM export is the one call that makes GitHub run a job (ADR 0011): only when the
  // supply chain is on and the provider may use it (the real one follows the owner's opt-in).
  // Issued first, so GitHub works while the other calls of the repository run.
  const sbomRequestPending =
    sc.enabled && p.dependencyGraphExport
      ? call(ctx, `sbomreq:${repository}`, () => p.requestDependencySbom(repository))
      : null;
  const analysisTools = sc.enabled ? mappedTools(ctx.policies) : [];
  const [
    head,
    release,
    securityStatusFile,
    codeScanning,
    codeScanningAnalysis,
    dependabot,
    secretScanning,
    qualitySummary,
    codeQualityFindings,
    controls,
    supplyChainSummary,
    analysisResults,
  ] = await Promise.all([
    call(ctx, `head:${repository}:${branch}`, () => p.getBranchHead(repository, branch)),
    call(ctx, `release:${repository}`, () => p.getLatestRelease(repository)),
    call(ctx, `file:${repository}:${securityStatusPath}`, () =>
      p.getFile(repository, securityStatusPath),
    ),
    call(ctx, `cs:${repository}`, () => p.listCodeScanningAlerts(repository)),
    call(ctx, `csa:${repository}`, () => p.getLatestCodeScanningAnalysis(repository)),
    call(ctx, `dep:${repository}`, () => p.listDependabotAlerts(repository)),
    call(ctx, `ss:${repository}`, () => p.listSecretScanningAlerts(repository)),
    call(ctx, `qs:${repository}:${branch}`, () => p.getQualitySummary(repository, branch)),
    call(ctx, `cq:${repository}`, () => p.listCodeQualityFindings(repository)),
    collectControls(ctx, repository, branch),
    sc.enabled
      ? call(ctx, `scs:${repository}:${branch}`, () => p.getSupplyChainSummary(repository, branch))
      : Promise.resolve(null),
    Promise.all(
      analysisTools.map(
        async (tool) =>
          [
            tool.toLowerCase(),
            await call(ctx, `csan:${repository}:${tool.toLowerCase()}:${branch}`, () =>
              p.listCodeScanningAnalyses(repository, tool, `refs/heads/${branch}`),
            ),
          ] as const,
      ),
    ),
  ]);
  const sbomRequest = sbomRequestPending ? await sbomRequestPending : null;
  const sbomFetch = sbomRequest?.ok ? await pollSbom(ctx, repository, sbomRequest.data.uuid) : null;
  const attestations = await collectAttestations(ctx, repository, release);
  // Fall back to the latest tag only when there is no GitHub Release.
  const tag =
    !release.ok && release.error.classification === 'not-found'
      ? await call(ctx, `tag:${repository}`, () => p.getLatestTag(repository))
      : null;
  return {
    componentId,
    repository,
    configuredDefaultBranch,
    branch,
    repo,
    head,
    release,
    tag,
    securityStatusFile,
    codeScanning,
    codeScanningAnalysis,
    dependabot,
    secretScanning,
    qualitySummary,
    codeQualityFindings,
    sbomRequest,
    sbomFetch,
    attestations,
    analyses: new Map(analysisResults),
    supplyChainSummary,
    controls,
  };
}

/** Distinct code-scanning tools of the mapped controls (Trivy, Checkov, ZAP by default). */
export function mappedTools(policies: Policies): string[] {
  const seen = new Map<string, string>();
  const rules = policies.supplyChain.toolControls;
  for (const rule of [...rules.containerScanning, ...rules.iacScanning, ...rules.dast])
    if (!seen.has(rule.tool.toLowerCase())) seen.set(rule.tool.toLowerCase(), rule.tool);
  return [...seen.values()];
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls the SBOM export: the first fetch, then at most `pollAttempts` more, each after
 * `pollIntervalSeconds`. A report that is still being generated stays "pending" (never 0).
 */
async function pollSbom(
  ctx: CollectContext,
  repository: string,
  uuid: string,
): Promise<ProviderResult<SbomFetchDTO>> {
  const { pollAttempts, pollIntervalSeconds } = ctx.policies.supplyChain.sbom;
  const sleep = ctx.sleep ?? realSleep;
  let last: ProviderResult<SbomFetchDTO> = { ok: true, data: { state: 'pending' } };
  for (let attempt = 0; attempt <= pollAttempts; attempt++) {
    if (attempt > 0) await sleep(pollIntervalSeconds * 1000);
    last = await call(ctx, `sbomfetch:${repository}:${attempt}`, () =>
      ctx.provider.fetchDependencySbom(repository, uuid),
    );
    if (!last.ok || last.data.state !== 'pending') return last;
  }
  return last;
}

/**
 * Attestation presence of the latest release's assets: at most `maxAssets` assets that have a
 * digest, sorted by name, one after the other. After the first 403 the remaining assets are
 * not asked. A tag fallback (no release) has no assets: 'skipped'.
 */
async function collectAttestations(
  ctx: CollectContext,
  repository: string,
  release: ProviderResult<ReleaseDTO>,
): Promise<RepoData['attestations']> {
  const { enabled, attestations } = ctx.policies.supplyChain;
  if (!enabled || !attestations.releaseAssets || !release.ok) return 'skipped';
  const digests = release.data.assets
    .filter((a): a is typeof a & { digest: string } => typeof a.digest === 'string')
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, attestations.maxAssets)
    .map((a) => a.digest);
  const results = new Map<string, ProviderResult<AttestationPresenceDTO>>();
  for (const digest of digests) {
    const result = await call(ctx, `att:${repository}:${digest}`, () =>
      ctx.provider.getAttestationPresence(repository, digest),
    );
    results.set(digest, result);
    if (!result.ok && result.error.classification === 'not-authorised') break;
  }
  return results;
}

const WORKFLOW_DIR = '.github/workflows';

/**
 * Repository controls: workflow directory and files at the branch, branch rules, optional
 * classic protection and the Scorecard analysis. Read-only; nothing is requested when the
 * block is disabled, and classic protection only when `readClassicProtection` is on.
 */
async function collectControls(
  ctx: CollectContext,
  repository: string,
  branch: string,
): Promise<RepoControlsData | null> {
  const pc = ctx.policies.repositoryControls;
  if (!pc.enabled) return null;
  const p = ctx.provider;
  const [workflowDir, rules, classic, scorecardAnalysis] = await Promise.all([
    call(ctx, `wfdir:${repository}:${branch}`, () =>
      p.listDirectory(repository, WORKFLOW_DIR, branch),
    ),
    call(ctx, `rules:${repository}:${branch}`, () => p.getBranchRules(repository, branch)),
    pc.readClassicProtection
      ? call(ctx, `classic:${repository}:${branch}`, () =>
          p.getClassicBranchProtection(repository, branch),
        )
      : Promise.resolve(null),
    call(ctx, `sca:${repository}`, () => p.getLatestScorecardAnalysis(repository)),
  ]);
  const workflowFiles = new Map<string, ProviderResult<FileDTO>>();
  let omittedFiles = 0;
  if (workflowDir.ok) {
    const all = workflowDir.data
      .filter((e) => e.type === 'file' && WORKFLOW_FILE.test(e.name))
      .map((e) => e.name)
      .sort();
    // A name longer than the published bound is never read: it counts as unreadable.
    const names = all.filter((n) => n.length <= MAX_WORKFLOW_FILE_NAME);
    omittedFiles = all.length - names.length + Math.max(0, names.length - pc.maxWorkflowFiles);
    await Promise.all(
      names.slice(0, pc.maxWorkflowFiles).map(async (name) => {
        workflowFiles.set(
          name,
          await call(ctx, `wf:${repository}:${branch}:${name}`, () =>
            p.getFile(repository, `${WORKFLOW_DIR}/${name}`, branch),
          ),
        );
      }),
    );
  }
  return { workflowDir, workflowFiles, omittedFiles, rules, classic, scorecardAnalysis };
}

/** At most this many distinct referenced repositories are resolved per run. */
export const MAX_REFERENCED_REPOSITORIES = 50;

/**
 * Latest release (or tag) and tags of the repositories that workflows reference as reusable
 * workflows. Calls go through the shared memo, so a monitored repository is never fetched
 * twice. `targets` are `owner/repo`; `shaTargets` (lower-case) need the tag list to resolve a
 * SHA ref. Over the limit, or not visible to the credentials: `visible: false` (never "behind").
 */
export async function collectReusableTargets(
  ctx: CollectContext,
  targets: string[],
  shaTargets: ReadonlySet<string> = new Set(),
): Promise<Map<string, TargetVersions>> {
  const distinct = new Map<string, string>();
  for (const t of [...targets].sort())
    if (!distinct.has(t.toLowerCase())) distinct.set(t.toLowerCase(), t);
  const result = new Map<string, TargetVersions>();
  const p = ctx.provider;
  await Promise.all(
    [...distinct].map(async ([key, repository], i) => {
      if (i >= MAX_REFERENCED_REPOSITORIES) {
        result.set(key, { latest: null, tags: null, visible: false });
        return;
      }
      const repo = await call(ctx, `repo:${repository}`, () => p.getRepository(repository));
      // A private target must not leak (version, existence) into a public site: treat it as
      // unreadable unless the audience is restricted.
      if (
        !repo.ok ||
        (repo.data.visibility !== 'public' && ctx.policies.publication.audience !== 'restricted')
      ) {
        result.set(key, { latest: null, tags: null, visible: false });
        return;
      }
      const release = await call(ctx, `release:${repository}`, () =>
        p.getLatestRelease(repository),
      );
      const tags = shaTargets.has(key)
        ? await call(ctx, `tags:${repository}`, () => p.listTags(repository))
        : null;
      // No release: fall back to the latest tag. When the tag list was read, its first entry is
      // that tag (same endpoint and order), so at most 3 calls are made per repository.
      let latestTag: string | null = null;
      if (!release.ok && release.error.classification === 'not-found') {
        if (tags) latestTag = tags.ok ? (tags.data[0]?.name ?? null) : null;
        else {
          const tag = await call(ctx, `tag:${repository}`, () => p.getLatestTag(repository));
          latestTag = tag.ok ? tag.data.name : null;
        }
      }
      result.set(key, {
        // Tag names come from repositories the hub does not monitor: kept only when exact
        // (at most 100 characters, unchanged by scrubbing), never truncated.
        latest: exactIdentifier(release.ok ? release.data.tagName : latestTag, 100),
        tags: tags?.ok
          ? tags.data.flatMap((t) => {
              const name = exactIdentifier(t.name, 100);
              return name ? [{ ...t, name }] : [];
            })
          : null,
        visible: true,
      });
    }),
  );
  return result;
}

/**
 * Tags of each coordinator repository, read only when Argo CD is on and an environment maps an
 * application: they turn an Argo CD revision (a SHA) into a version.
 */
export async function collectCoordinatorTags(
  ctx: CollectContext,
  raws: RawProjectData[],
): Promise<void> {
  await Promise.all(
    raws.map(async (raw) => {
      const coordinator = raw.repos[0];
      if (!coordinator?.repo.ok || !raw.config.environments.some((e) => e.argocdApplication))
        return;
      const repository = raw.config.coordinator.repository;
      raw.coordinatorTags = await call(ctx, `tags:${repository}`, () =>
        ctx.provider.listTags(repository),
      );
    }),
  );
}

export async function collectProject(
  ctx: CollectContext,
  config: ProjectConfig,
): Promise<RawProjectData> {
  const branchOf = (componentId: string): string | null =>
    componentId === 'coordinator'
      ? (config.coordinator.defaultBranch ?? null)
      : (config.components.find((c) => c.id === componentId)?.defaultBranch ?? null);

  const repos = await Promise.all(
    projectTargets(config).map((t) =>
      collectRepository(
        ctx,
        t.componentId,
        t.repository,
        branchOf(t.componentId),
        config.securityStatusPath,
      ),
    ),
  );
  const coordinator = repos[0]!;
  const p = ctx.provider;
  const coordRepo = config.coordinator.repository;
  const ref = coordinator.branch ?? undefined;

  const [manifest, gitmodules] = coordinator.repo.ok
    ? await Promise.all([
        call(ctx, `file:${coordRepo}:${config.coordinator.manifestPath}`, () =>
          p.getFile(coordRepo, config.coordinator.manifestPath, ref),
        ),
        call(ctx, `file:${coordRepo}:.gitmodules`, () => p.getFile(coordRepo, '.gitmodules', ref)),
      ])
    : [skipped<FileDTO>(coordinator.repo), skipped<FileDTO>(coordinator.repo)];

  const submodules = gitmodules.ok ? parseGitmodules(gitmodules.data.text) : [];
  const submoduleRefs = new Map<string, ProviderResult<SubmoduleRefDTO>>();
  await Promise.all(
    submodules.map(async (s) => {
      submoduleRefs.set(
        s.path,
        await call(ctx, `sub:${coordRepo}:${s.path}`, () =>
          p.getSubmoduleRef(coordRepo, s.path, ref),
        ),
      );
    }),
  );

  // Components versioned by tag prefix (typical in monorepos: "api-v1.2.0"): read the tags.
  const componentTags = new Map<string, ProviderResult<TagDTO[]>>();
  await Promise.all(
    config.components
      .filter((c) => c.releaseTagPrefix)
      .map(async (c) => {
        const data = repos.find((r) => r.componentId === c.id);
        if (!data?.repo.ok) return;
        componentTags.set(
          c.id,
          await call(ctx, `tags:${c.repository}`, () => p.listTags(c.repository)),
        );
      }),
  );

  // Resolve the SHA pinned for each linked component into a tag (or a distance from the
  // latest release when the SHA is not tagged).
  const pins: PinData[] = [];
  await Promise.all(
    associateSubmodules(config, submodules).map(async (a) => {
      const ref = submoduleRefs.get(a.entry.path);
      if (!a.component || !ref?.ok) return;
      const repoData = repos.find((r) => r.componentId === a.component!.id);
      if (!repoData?.repo.ok) return;
      const repository = a.component.repository;
      const sha = ref.data.sha;
      const tags = await call(ctx, `tags:${repository}`, () => p.listTags(repository));
      const tagged = tags.ok && tags.data.some((t) => t.sha === sha);
      const base = repoData.release.ok ? repoData.release.data.tagName : null;
      const compare =
        !tagged && base
          ? await call(ctx, `cmp:${repository}:${base}...${sha}`, () =>
              p.compareCommits(repository, base, sha),
            )
          : null;
      pins.push({
        componentId: a.component.id,
        sha,
        tags,
        compareBase: compare ? base : null,
        compare,
      });
    }),
  );

  const workflows: WorkflowData[] = [];
  await Promise.all(
    config.trackedWorkflows.flatMap((workflow) => {
      const targets = workflow.appliesTo ?? config.components.map((c) => c.id);
      return targets.map(async (componentId) => {
        const data = repos.find((r) => r.componentId === componentId)!;
        const runs = data.repo.ok
          ? await call(ctx, `runs:${data.repository}:${workflow.file}:${data.branch}`, () =>
              p.listWorkflowRuns(data.repository, workflow.file, data.branch ?? undefined),
            )
          : skipped<WorkflowRunDTO[]>(data.repo);
        const lastCompleted = runs.ok ? lastCompletedRun(branchRuns(runs.data)) : undefined;
        const failure =
          lastCompleted && FAILED_CONCLUSIONS.has(lastCompleted.conclusion ?? '')
            ? await call(ctx, `fail:${data.repository}:${lastCompleted.id}`, () =>
                p.getRunFailure(data.repository, lastCompleted.id),
              )
            : null;
        workflows.push({
          workflow,
          componentId,
          repository: data.repository,
          branch: data.branch,
          runs,
          failure,
        });
      });
    }),
  );
  // Promise.all completion order is not deterministic: keep catalog order.
  const order = (w: WorkflowData) =>
    config.trackedWorkflows.indexOf(w.workflow) * 1000 +
    repos.findIndex((r) => r.componentId === w.componentId);
  workflows.sort((a, b) => order(a) - order(b));

  return {
    config,
    repos,
    manifest,
    gitmodules,
    submodules,
    submoduleRefs,
    pins,
    componentTags,
    workflows,
  };
}
