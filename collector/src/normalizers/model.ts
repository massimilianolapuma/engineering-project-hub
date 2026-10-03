import type {
  CollectionError,
  ErrorClassification,
  Policies,
  ReleaseInfo,
  RepositoryInfo,
  WorkflowRun,
  WorkflowState,
  WorkflowStatus,
} from '@model/index';
import {
  branchRuns,
  FAILED_CONCLUSIONS,
  lastCompletedRun,
  type RepoData,
  type WorkflowData,
} from '../collectors/collect';
import type {
  ProviderError,
  ProviderResult,
  ReleaseDTO,
  TagDTO,
  WorkflowRunDTO,
} from '../providers/types';
import { sanitizeUrl, scrubIdentifier, scrubText } from '../sanitizers/sanitize';
import { ageMs, DAY_MS } from '../util/clock';

export interface BuildContext {
  projectId: string;
  policies: Policies;
  now: Date;
  errors: CollectionError[];
}

/** Classifications that describe a real collection problem (vs. an expected absence). */
const ERROR_CLASSES: ReadonlySet<ErrorClassification> = new Set([
  'not-authorised',
  'rate-limited',
  'error',
  'invalid-data',
]);

/**
 * Records a failed provider call. `expectedNotFound` marks sources where a 404 is a normal
 * state (no release yet, file not present, workflow not defined) rather than an error.
 */
export function recordError(
  ctx: BuildContext,
  repository: string,
  componentId: string | undefined,
  source: CollectionError['source'],
  result: ProviderResult<unknown> | null,
  opts: { expectedNotFound?: boolean } = {},
): void {
  if (!result || result.ok) return;
  // Already reported once as the repository error.
  if (result.error.skipped) return;
  const { classification } = result.error;
  const reportable =
    ERROR_CLASSES.has(classification) || (classification === 'not-found' && !opts.expectedNotFound);
  if (!reportable) return;
  pushError(ctx, repository, componentId, source, result.error);
}

export function pushError(
  ctx: BuildContext,
  repository: string,
  componentId: string | undefined,
  source: CollectionError['source'],
  error: ProviderError,
): void {
  const detail = scrubText(error.message, 160);
  ctx.errors.push({
    repository,
    ...(componentId ? { componentId } : {}),
    source,
    classification: error.classification,
    ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}),
    ...(detail ? { detail } : {}),
  });
}

export const link = (ctx: BuildContext, url: string | null | undefined) =>
  sanitizeUrl(url, ctx.policies.publication.allowedLinkHosts);

export function toRepositoryInfo(ctx: BuildContext, data: RepoData): RepositoryInfo {
  const [owner = '', name = ''] = data.repository.split('/');
  if (!data.repo.ok) {
    const c = data.repo.error.classification;
    return {
      fullName: data.repository,
      owner,
      name,
      url: link(ctx, `https://github.com/${data.repository}`),
      status: c === 'not-found' || c === 'not-authorised' || c === 'rate-limited' ? c : 'error',
      visibility: 'unknown',
      defaultBranch: null,
      configuredDefaultBranch: data.configuredDefaultBranch,
      archived: null,
      updatedAt: null,
      topics: [],
      latestCommit: null,
    };
  }
  const r = data.repo.data;
  return {
    fullName: r.fullName,
    owner: r.owner,
    name: r.name,
    url: link(ctx, r.htmlUrl),
    status: 'ok',
    visibility: r.visibility,
    defaultBranch: r.defaultBranch,
    configuredDefaultBranch: data.configuredDefaultBranch,
    archived: r.archived,
    updatedAt: r.updatedAt,
    topics: r.topics
      .map((t) => scrubIdentifier(t, 50))
      .filter((t): t is string => !!t)
      .slice(0, 30),
    latestCommit: data.head.ok
      ? {
          sha: data.head.data.sha,
          url: link(ctx, data.head.data.htmlUrl),
          committedAt: data.head.data.committedAt,
        }
      : null,
  };
}

export function toReleaseInfo(
  ctx: BuildContext,
  repository: string,
  release: ProviderResult<ReleaseDTO>,
  tag: ProviderResult<TagDTO> | null,
): ReleaseInfo | null {
  if (release.ok) {
    const tagName = scrubIdentifier(release.data.tagName);
    if (!tagName) return null;
    return {
      tag: tagName,
      name: scrubText(release.data.name, 100),
      publishedAt: release.data.publishedAt,
      prerelease: release.data.prerelease,
      url: link(ctx, release.data.htmlUrl),
      kind: 'release',
    };
  }
  if (tag?.ok) {
    const tagName = scrubIdentifier(tag.data.name);
    if (!tagName) return null;
    return {
      tag: tagName,
      name: null,
      publishedAt: null,
      prerelease: false,
      url: link(
        ctx,
        `https://github.com/${repository}/releases/tag/${encodeURIComponent(tagName)}`,
      ),
      kind: 'tag',
    };
  }
  return null;
}

const ACTIVE_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);

function toRun(ctx: BuildContext, r: WorkflowRunDTO): WorkflowRun {
  return {
    id: r.id,
    runNumber: r.runNumber,
    runAttempt: r.runAttempt,
    status: scrubIdentifier(r.status, 30) ?? 'unknown',
    conclusion: scrubIdentifier(r.conclusion, 30),
    branch: scrubIdentifier(r.headBranch, 255),
    event: scrubIdentifier(r.event, 50) ?? 'unknown',
    sha: r.headSha && /^[0-9a-f]{40}$/.test(r.headSha) ? r.headSha : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    url: link(ctx, r.htmlUrl),
  };
}

export function toWorkflowStatus(ctx: BuildContext, w: WorkflowData): WorkflowStatus {
  const base = {
    workflowId: w.workflow.id,
    name: w.workflow.name,
    file: w.workflow.file,
    critical: w.workflow.critical,
    componentId: w.componentId,
    repository: w.repository,
    branch: w.branch,
  };
  const empty = {
    latestRun: null,
    lastCompletedRun: null,
    lastFailedRun: null,
    activeRun: null,
    lastError: null,
    stale: false,
  };
  if (!w.runs.ok) {
    const c = w.runs.error.classification;
    const state: WorkflowState =
      c === 'not-found' ? 'missing' : c === 'not-authorised' ? 'not-authorised' : 'unknown';
    return { ...base, ...empty, state };
  }
  const runs = branchRuns(w.runs.data);
  const latest = runs[0];
  const completed = lastCompletedRun(runs);
  const failed = runs.find(
    (r) => r.status === 'completed' && FAILED_CONCLUSIONS.has(r.conclusion ?? ''),
  );
  const active = runs.find((r) => ACTIVE_STATUSES.has(r.status));

  let state: WorkflowState;
  if (!latest) state = 'never-run';
  else if (completed) {
    const c = completed.conclusion ?? '';
    state = FAILED_CONCLUSIONS.has(c)
      ? 'failure'
      : c === 'cancelled'
        ? 'cancelled'
        : c === 'success' || c === 'neutral' || c === 'skipped'
          ? 'success'
          : 'unknown';
  } else state = active?.status === 'in_progress' ? 'in-progress' : 'queued';

  const age = ageMs(completed?.updatedAt, ctx.now);
  const stale = age !== null && age > ctx.policies.freshness.workflowRunStaleDays * DAY_MS;

  let lastError: string | null = null;
  if (state === 'failure' && w.failure?.ok && w.failure.data) {
    const { jobName, stepName } = w.failure.data;
    lastError = scrubText(
      [jobName && `Job "${jobName}"`, stepName && `step "${stepName}"`].filter(Boolean).join(' · '),
      160,
    );
  }
  return {
    ...base,
    state,
    stale,
    latestRun: latest ? toRun(ctx, latest) : null,
    lastCompletedRun: completed ? toRun(ctx, completed) : null,
    lastFailedRun: failed ? toRun(ctx, failed) : null,
    activeRun: active ? toRun(ctx, active) : null,
    lastError,
  };
}
