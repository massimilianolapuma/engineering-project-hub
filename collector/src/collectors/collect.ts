import { projectTargets, type ProjectConfig, type TrackedWorkflowConfig } from '@model/index';
import { associateSubmodules } from '../normalizers/association';
import { memoize } from '../util/concurrency';
import { parseGitmodules, type GitmoduleEntry } from '../util/gitmodules';
import {
  fail,
  type CodeScanningAlertDTO,
  type CodeScanningAnalysisDTO,
  type CommitRefDTO,
  type CompareDTO,
  type DependabotAlertDTO,
  type FileDTO,
  type ProviderResult,
  type ReleaseDTO,
  type RunFailureDTO,
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
  workflows: WorkflowData[];
}

export interface CollectContext {
  provider: SourceProvider;
  limit: <T>(task: () => Promise<T>) => Promise<T>;
  /** Shared across projects: one fetch per repository and call. */
  cache: Map<string, Promise<unknown>>;
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
    };
  }
  const branch = configuredDefaultBranch ?? repo.data.defaultBranch;
  const [
    head,
    release,
    securityStatusFile,
    codeScanning,
    codeScanningAnalysis,
    dependabot,
    secretScanning,
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
  ]);
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
  };
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

  return { config, repos, manifest, gitmodules, submodules, submoduleRefs, pins, workflows };
}
