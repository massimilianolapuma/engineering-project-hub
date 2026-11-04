/** Pure selection rules for the hub's own `hub-history` artifact (planted-history defence). */

export interface ArtifactLike {
  id: number;
  name: string;
  expired: boolean;
  size_in_bytes: number;
  created_at: string | null;
  workflow_run?: {
    id?: number;
    repository_id?: number;
    head_repository_id?: number;
    head_branch?: string | null;
  } | null;
}

export interface RunLike {
  id: number;
  path: string;
  event: string;
}

export const HISTORY_ARTIFACT = 'hub-history';
export const MAX_ARTIFACT_BYTES = 5_242_880;
export const MAX_CANDIDATES = 5;
export const ALLOWED_PATHS = [
  '.github/workflows/deploy-pages.yml',
  '.github/workflows/collect-data.yml',
];
export const ALLOWED_EVENTS = ['schedule', 'push', 'workflow_dispatch', 'repository_dispatch'];

export type RestoreOutcome =
  | { state: 'restored' }
  | { state: 'none'; reason: 'no-artifact' }
  | { state: 'failed'; reason: 'not-authorised' | 'bad-archive' | 'api-error' };

/**
 * Artifacts that may be restored: right name, not expired, within the size cap, produced on
 * the default branch of this very repository (no fork, no other branch) by another run.
 * Newest first, at most MAX_CANDIDATES. An artifact without run metadata is dropped.
 */
export function candidateArtifacts(
  list: ArtifactLike[],
  o: {
    repositoryId: number;
    defaultBranch: string;
    currentRunId: number;
    /** Artifact name; default hub-history. */
    name?: string;
    /**
     * The notification ledger must see an earlier attempt of the same run (a re-run after a
     * successful send); history never does (its own run has not uploaded yet).
     */
    includeCurrentRun?: boolean;
  },
): ArtifactLike[] {
  const name = o.name ?? HISTORY_ARTIFACT;
  const time = (a: ArtifactLike): number => {
    const t = Date.parse(a.created_at ?? '');
    return Number.isNaN(t) ? 0 : t;
  };
  return list
    .filter((a) => {
      const run = a.workflow_run;
      return (
        a.name === name &&
        !a.expired &&
        a.size_in_bytes <= MAX_ARTIFACT_BYTES &&
        run != null &&
        run.repository_id === o.repositoryId &&
        run.head_repository_id === o.repositoryId &&
        run.head_branch === o.defaultBranch &&
        run.id !== undefined &&
        (o.includeCurrentRun === true || run.id !== o.currentRunId)
      );
    })
    .sort((x, y) => time(y) - time(x))
    .slice(0, MAX_CANDIDATES);
}

/**
 * The producing run must be the deploy or collect workflow, on a trusted event. `extraPaths` adds
 * the calling workflow of the protected deploy path (a deploy repository names its own file).
 */
export function runIsTrusted(run: RunLike, extraPaths: readonly string[] = []): boolean {
  const path = run.path.split('@')[0] ?? '';
  return (
    (ALLOWED_PATHS.includes(path) || extraPaths.includes(path)) &&
    ALLOWED_EVENTS.includes(run.event)
  );
}

const WORKFLOW_REF = /^[^/]+\/[^/]+\/(\.github\/workflows\/[\w-]+(?:\.[\w-]+)*\.ya?ml)@/;

/**
 * Workflow file path of GITHUB_WORKFLOW_REF ("owner/repo/.github/workflows/x.yml@ref" →
 * ".github/workflows/x.yml"); null for anything else (no "..", no other directory).
 */
export function workflowPathFromRef(ref: string | undefined): string | null {
  const m = WORKFLOW_REF.exec(ref ?? '');
  return m && !m[1]!.includes('..') ? m[1]! : null;
}
