import type { RepositoryCheckId } from '@model/index';
import type { RepoControlsInput } from '../evaluators/repository-controls';
import type { RawProjectData, RepoControlsData, RepoData } from '../collectors/collect';
import { fail, MAX_WORKFLOW_FILE_NAME, WORKFLOW_FILE } from '../providers/types';
import { exactIdentifier } from '../sanitizers/sanitize';
import { link, recordError, type BuildContext } from './model';
import { isPublicDetail } from './security-model';
import { parseWorkflow, type ParsedWorkflow, type TargetVersions } from './workflow-refs';

/*
 * Maps the raw repository-controls data of a repository onto the evaluator's input. Workflow
 * text is parsed here and dropped: only the parsed references travel on.
 */

interface ParsedRepoWorkflows {
  files: ParsedWorkflow[];
  /** Files that could not be read, or were left unread by `maxWorkflowFiles`. */
  unreadable: number;
}

const parsedCache = new WeakMap<RepoControlsData, ParsedRepoWorkflows>();

/** Parses the workflow files of a repository (once per collection). */
export function parsedWorkflows(controls: RepoControlsData): ParsedRepoWorkflows {
  const hit = parsedCache.get(controls);
  if (hit) return hit;
  const files: ParsedWorkflow[] = [];
  let unreadable = controls.omittedFiles;
  for (const name of [...controls.workflowFiles.keys()].sort()) {
    const result = controls.workflowFiles.get(name)!;
    // The file name is published (unpinned reference lists). A name the schema would refuse
    // (over 100 characters, or altered by scrubbing) is unreadable, never renamed.
    const safeName = WORKFLOW_FILE.test(name)
      ? exactIdentifier(name, MAX_WORKFLOW_FILE_NAME)
      : null;
    if (!result.ok || !safeName) {
      unreadable++;
      continue;
    }
    files.push(parseWorkflow(safeName, result.data.text));
  }
  const parsed = { files, unreadable };
  parsedCache.set(controls, parsed);
  return parsed;
}

/** Repositories referenced as reusable workflows, and those whose tags are needed (SHA refs). */
export function referencedRepositories(repos: RepoData[]): {
  targets: string[];
  shaTargets: Set<string>;
} {
  const targets = new Set<string>();
  const shaTargets = new Set<string>();
  for (const r of repos) {
    if (!r.controls) continue;
    for (const f of parsedWorkflows(r.controls).files) {
      for (const ref of f.refs) {
        if (ref.kind !== 'reusable-workflow' || !ref.owner || !ref.repo) continue;
        const target = `${ref.owner}/${ref.repo}`;
        targets.add(target);
        if (ref.pinned) shaTargets.add(target.toLowerCase());
      }
    }
  }
  return { targets: [...targets], shaTargets };
}

function workflowsOf(controls: RepoControlsData): RepoControlsInput['workflows'] {
  const dir = controls.workflowDir;
  if (!dir.ok) {
    if (dir.error.skipped) return { state: 'unknown' };
    // A 404 on the directory means the repository has no workflows.
    if (dir.error.classification === 'not-found') return { state: 'none' };
    return { state: dir.error.classification === 'not-authorised' ? 'not-authorised' : 'unknown' };
  }
  const { files, unreadable } = parsedWorkflows(controls);
  return { state: 'read', files, unreadable, capped: false };
}

/** One input per unique repository; the catalog's `notApplicableChecks` must hold for every target. */
export function toControlsInputs(
  ctx: BuildContext,
  raw: RawProjectData,
  uniqueRepos: RepoData[],
  reusable: Map<string, TargetVersions>,
): RepoControlsInput[] {
  const { config } = raw;
  const notApplicableOf = (componentId: string): RepositoryCheckId[] =>
    componentId === 'coordinator'
      ? config.coordinator.notApplicableChecks
      : (config.components.find((c) => c.id === componentId)?.notApplicableChecks ?? []);

  return uniqueRepos.map((r) => {
    const targets = raw.repos.filter(
      (x) => x.repository.toLowerCase() === r.repository.toLowerCase(),
    );
    const [first, ...rest] = targets.map((t) => notApplicableOf(t.componentId));
    const notApplicable = (first ?? []).filter((id) => rest.every((list) => list.includes(id)));
    const c = r.controls;
    const unreadable = fail<never>({ classification: 'error', skipped: true });
    const alerts = r.codeScanning.ok
      ? r.codeScanning.data
          .filter((a) => a.state === 'open' && a.toolName?.toLowerCase() === 'scorecard')
          .map((a) => ({ ruleId: a.ruleId }))
      : null;
    return {
      repository: r.repository,
      componentIds: targets.map((t) => t.componentId),
      branch: r.repo.ok ? r.branch : null,
      available: r.repo.ok,
      archived: r.repo.ok && r.repo.data.archived,
      notApplicable,
      workflows: c ? workflowsOf(c) : { state: 'unknown' },
      reusable,
      rules: c?.rules ?? unreadable,
      protected: r.head.ok ? (r.head.data.protected ?? null) : null,
      classic: c?.classic ?? null,
      scorecardAnalysis: c?.scorecardAnalysis ?? unreadable,
      scorecardAlerts: alerts,
      publicDetails: isPublicDetail(ctx, r),
      repositoryUrlFor: (target) => link(ctx, `https://github.com/${target}`),
    };
  });
}

/**
 * One error per source and unique repository. A 404 on the workflows directory is expected
 * (no workflows); a 404 on the rules is unknown and is recorded. Referenced repositories are
 * not monitored and never produce errors.
 */
export function recordControlsErrors(ctx: BuildContext, r: RepoData): void {
  const c = r.controls;
  if (!c || !r.repo.ok) return;
  recordError(ctx, r.repository, r.componentId, 'workflow-files', c.workflowDir, {
    expectedNotFound: true,
  });
  const failedFile = [...c.workflowFiles.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, result]) => result)
    .find((result) => !result.ok);
  recordError(ctx, r.repository, r.componentId, 'workflow-files', failedFile ?? null);
  recordError(ctx, r.repository, r.componentId, 'repository-rules', c.rules);
  recordError(ctx, r.repository, r.componentId, 'repository-rules', c.classic);
  recordError(ctx, r.repository, r.componentId, 'scorecard-analysis', c.scorecardAnalysis, {
    expectedNotFound: true,
  });
}
