import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveRelativeTime, type Clock } from '../../util/clock';
import {
  fail,
  ok,
  type CodeScanningAlertDTO,
  type CodeScanningAnalysisDTO,
  type CommitRefDTO,
  type CompareDTO,
  type DependabotAlertDTO,
  type FileDTO,
  type ProviderError,
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

/**
 * Fixture format (fixtures/github/<owner>__<repo>.json). Every value is synthetic.
 * Any value may be replaced by {"$error": {classification, httpStatus?, message?}} to simulate
 * an API failure. Timestamps may use relative tokens ("@now-2h", "@now-20d") resolved
 * against the collector clock, so the demo keeps the intended freshness over time.
 */
export interface RepoFixture {
  repository: RepositoryDTO | ErrorFixture;
  head?: Omit<CommitRefDTO, 'htmlUrl'> | ErrorFixture;
  latestRelease?: ReleaseDTO | ErrorFixture;
  latestTag?: TagDTO | ErrorFixture;
  /** Tags newest first; defaults to [latestTag] when absent. */
  tags?: TagDTO[] | ErrorFixture;
  /** Keyed by "base...head". */
  comparisons?: Record<string, CompareDTO | ErrorFixture>;
  files?: Record<string, string | ErrorFixture>;
  submodules?: Record<string, string | ErrorFixture>;
  workflowRuns?: Record<string, WorkflowRunDTO[] | ErrorFixture>;
  runFailures?: Record<string, RunFailureDTO>;
  codeScanningAlerts?: CodeScanningAlertDTO[] | ErrorFixture;
  codeScanningAnalysis?: CodeScanningAnalysisDTO | null | ErrorFixture;
  dependabotAlerts?: DependabotAlertDTO[] | ErrorFixture;
  secretScanningAlerts?: SecretScanningAlertDTO[] | ErrorFixture;
}

interface ErrorFixture {
  $error: ProviderError;
}

const isError = (v: unknown): v is ErrorFixture =>
  typeof v === 'object' && v !== null && '$error' in v;
const NOT_FOUND: ProviderError = { classification: 'not-found', httpStatus: 404 };

const TOKEN_IN_TEXT = /@now(?:[+-]\d+[mhd])?/g;

function resolveTokens<T>(value: T, now: Date): T {
  if (typeof value === 'string') {
    // Whole-value tokens and tokens embedded in file contents (e.g. a status file's generatedAt).
    return (resolveRelativeTime(value, now) ??
      value.replace(TOKEN_IN_TEXT, (t) => resolveRelativeTime(t, now) ?? t)) as T;
  }
  if (Array.isArray(value)) return value.map((v) => resolveTokens(v, now)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveTokens(v, now)]),
    ) as T;
  }
  return value;
}

export class MockProvider implements SourceProvider {
  readonly dataSource = 'mock' as const;
  readonly authenticationMode = 'mock' as const;
  private readonly cache = new Map<string, Promise<RepoFixture | null>>();

  constructor(
    private readonly fixturesDir: string,
    private readonly clock: Clock,
  ) {}

  private fixture(repo: string): Promise<RepoFixture | null> {
    let hit = this.cache.get(repo);
    if (!hit) {
      const file = join(this.fixturesDir, `${repo.replace('/', '__')}.json`);
      hit = readFile(file, 'utf8').then(
        (text) => resolveTokens(JSON.parse(text) as RepoFixture, this.clock()),
        () => null,
      );
      this.cache.set(repo, hit);
    }
    return hit;
  }

  private async pick<T>(
    repo: string,
    select: (f: RepoFixture) => T | ErrorFixture | undefined,
    absent: ProviderResult<T> = fail(NOT_FOUND),
  ) {
    const f = await this.fixture(repo);
    if (!f) return fail<T>(NOT_FOUND);
    if (isError(f.repository)) return fail<T>(f.repository.$error);
    const v = select(f);
    if (v === undefined) return absent;
    return isError(v) ? fail<T>(v.$error) : ok(v);
  }

  async getRepository(repo: string): Promise<ProviderResult<RepositoryDTO>> {
    const f = await this.fixture(repo);
    if (!f) return fail(NOT_FOUND);
    return isError(f.repository) ? fail(f.repository.$error) : ok(f.repository);
  }

  async getBranchHead(repo: string): Promise<ProviderResult<CommitRefDTO>> {
    const r = await this.pick(repo, (f) => f.head);
    return r.ok ? ok({ ...r.data, htmlUrl: `https://github.com/${repo}/commit/${r.data.sha}` }) : r;
  }

  getLatestRelease(repo: string) {
    return this.pick(repo, (f) => f.latestRelease);
  }

  getLatestTag(repo: string) {
    return this.pick(repo, (f) => f.latestTag);
  }

  async listTags(repo: string): Promise<ProviderResult<TagDTO[]>> {
    const f = await this.fixture(repo);
    if (f && !isError(f.repository) && f.tags === undefined) {
      return f.latestTag && !isError(f.latestTag) ? ok([f.latestTag]) : ok([]);
    }
    return this.pick(repo, (x) => x.tags);
  }

  compareCommits(repo: string, base: string, head: string) {
    return this.pick(repo, (f) => f.comparisons?.[`${base}...${head}`]);
  }

  async getFile(repo: string, path: string): Promise<ProviderResult<FileDTO>> {
    const r = await this.pick(repo, (f) => f.files?.[path]);
    return r.ok ? ok({ text: r.data }) : r;
  }

  async getSubmoduleRef(repo: string, path: string): Promise<ProviderResult<SubmoduleRefDTO>> {
    const r = await this.pick(repo, (f) => f.submodules?.[path]);
    return r.ok ? ok({ path, sha: r.data }) : r;
  }

  listWorkflowRuns(repo: string, workflowFile: string) {
    return this.pick(repo, (f) => f.workflowRuns?.[workflowFile]);
  }

  getRunFailure(repo: string, runId: number) {
    return this.pick<RunFailureDTO | null>(repo, (f) => f.runFailures?.[String(runId)], ok(null));
  }

  listCodeScanningAlerts(repo: string) {
    return this.pick(repo, (f) => f.codeScanningAlerts);
  }

  getLatestCodeScanningAnalysis(repo: string) {
    return this.pick<CodeScanningAnalysisDTO | null>(repo, (f) => f.codeScanningAnalysis, ok(null));
  }

  listDependabotAlerts(repo: string) {
    return this.pick(repo, (f) => f.dependabotAlerts);
  }

  listSecretScanningAlerts(repo: string) {
    return this.pick(repo, (f) => f.secretScanningAlerts);
  }
}
