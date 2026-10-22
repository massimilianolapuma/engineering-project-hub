import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveRelativeTime, type Clock } from '../../util/clock';
import {
  fail,
  ok,
  type BranchRuleDTO,
  type ClassicProtectionDTO,
  type CodeQualityFindingDTO,
  type CustomPropertyDTO,
  type CodeScanningAlertDTO,
  type CodeScanningAnalysisDTO,
  type CommitRefDTO,
  type CompareDTO,
  type DirectoryEntryDTO,
  type WorkflowDTO,
  type DependabotAlertDTO,
  type FileDTO,
  type ProviderError,
  type ProviderResult,
  type QualitySummaryArtifactDTO,
  type ReleaseDTO,
  type RepositoryDTO,
  type RunFailureDTO,
  type SbomFetchDTO,
  type SbomRequestDTO,
  type SecretScanningAlertDTO,
  type SourceProvider,
  type SubmoduleRefDTO,
  type TagDTO,
  type TeamDTO,
  type TeamPermission,
  type TeamRepositoryDTO,
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
  /** Rules applying to the default branch; absent → no rules. */
  branchRules?: BranchRuleDTO[] | ErrorFixture;
  /** Absent → no classic protection (ok(null)). */
  classicProtection?: ClassicProtectionDTO | null | ErrorFixture;
  /** Absent → no Scorecard analysis (ok(null)). */
  scorecardAnalysis?: CodeScanningAnalysisDTO | null | ErrorFixture;
  customProperties?: CustomPropertyDTO[] | ErrorFixture;
  latestRelease?: ReleaseDTO | ErrorFixture;
  latestTag?: TagDTO | ErrorFixture;
  /** Tags newest first; defaults to [latestTag] when absent. */
  tags?: TagDTO[] | ErrorFixture;
  /** Keyed by "base...head". */
  comparisons?: Record<string, CompareDTO | ErrorFixture>;
  /** Directory listings keyed by path ("" = root). */
  directories?: Record<string, DirectoryEntryDTO[]>;
  workflows?: WorkflowDTO[];
  files?: Record<string, string | ErrorFixture>;
  submodules?: Record<string, string | ErrorFixture>;
  workflowRuns?: Record<string, WorkflowRunDTO[] | ErrorFixture>;
  runFailures?: Record<string, RunFailureDTO>;
  codeScanningAlerts?: CodeScanningAlertDTO[] | ErrorFixture;
  codeScanningAnalysis?: CodeScanningAnalysisDTO | null | ErrorFixture;
  dependabotAlerts?: DependabotAlertDTO[] | ErrorFixture;
  secretScanningAlerts?: SecretScanningAlertDTO[] | ErrorFixture;
  qualitySummary?:
    { summary: unknown; createdAt: string; expired?: boolean; runId: number } | ErrorFixture;
  codeQualityFindings?: CodeQualityFindingDTO[] | ErrorFixture;
  /**
   * Dependency-graph SBOM export. `pending`: every fetch answers 202; `document`: a ready SPDX
   * document; `expand`: a synthetic SPDX 2.3 document built from counts (no real package names).
   * Absent → "dependency graph not enabled" (not-configured).
   */
  dependencySbom?:
    { pending: true } | { document: unknown } | { expand: SbomExpand } | ErrorFixture;
}

/** Synthetic SPDX document: a root package, then `count` packages per entry, then `extra`. */
export interface SbomExpand {
  name: string;
  spdxVersion?: string;
  created: string;
  packages: { count: number; license: string | null; purl: string | null }[];
  extra?: { name: string; license: string | null; purl: string | null }[];
}

const MOCK_SBOM_UUID = '00000000-0000-4000-8000-000000000000';

function spdxFromExpand(e: SbomExpand): unknown {
  const pkg = (id: string, name: string, license: string | null, purl: string | null) => ({
    SPDXID: id,
    name,
    versionInfo: '1.0.0',
    licenseConcluded: license ?? 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
    ...(purl
      ? {
          externalRefs: [
            {
              referenceCategory: 'PACKAGE-MANAGER',
              referenceType: 'purl',
              referenceLocator: `pkg:${purl}/${name}@1.0.0`,
            },
          ],
        }
      : {}),
  });
  const packages: unknown[] = [{ SPDXID: 'SPDXRef-root', name: `com.github.${e.name}` }];
  let n = 0;
  for (const group of e.packages) {
    for (let i = 0; i < group.count; i++, n++)
      packages.push(
        pkg(`SPDXRef-p${n}`, `synthetic-${group.purl ?? 'none'}-${n}`, group.license, group.purl),
      );
  }
  for (const extra of e.extra ?? [])
    packages.push(pkg(`SPDXRef-p${n++}`, extra.name, extra.license, extra.purl));
  return {
    spdxVersion: e.spdxVersion ?? 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `com.github.${e.name}`,
    creationInfo: { created: e.created, creators: ['Tool: synthetic-fixture'] },
    packages,
    relationships: [
      {
        spdxElementId: 'SPDXRef-DOCUMENT',
        relationshipType: 'DESCRIBES',
        relatedSpdxElement: 'SPDXRef-root',
      },
    ],
  };
}

interface TeamFixture {
  slug: string;
  name: string;
  privacy: 'closed' | 'secret';
  /** Present only to prove it is dropped. */
  description?: string;
  repos: { fullName: string; permission: TeamPermission | null }[];
  /** Makes listTeamRepositories fail for this team. */
  $error?: ProviderError;
}

interface ErrorFixture {
  $error: ProviderError;
}

const isError = (v: unknown): v is ErrorFixture =>
  typeof v === 'object' && v !== null && '$error' in v;
const NOT_FOUND: ProviderError = { classification: 'not-found', httpStatus: 404 };
const notEnabled = (): ProviderResult<never> =>
  fail({
    classification: 'not-configured',
    httpStatus: 403,
    message: 'Dependency graph is not enabled for this repository',
  });

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

  /** Owner listing = every fixture file of that owner whose repository is readable. */
  async listOwnerRepositories(
    owner: string,
    opts: { includePrivate: boolean; max: number },
  ): Promise<ProviderResult<RepositoryDTO[]>> {
    let files: string[];
    try {
      files = (await readdir(this.fixturesDir)).filter((f) => f.startsWith(`${owner}__`)).sort();
    } catch {
      return fail(NOT_FOUND);
    }
    if (!files.length) return fail(NOT_FOUND);
    const out: RepositoryDTO[] = [];
    for (const f of files) {
      const r = await this.getRepository(f.replace('__', '/').replace(/\.json$/, ''));
      if (r.ok && (opts.includePrivate || r.data.visibility === 'public')) out.push(r.data);
      if (out.length >= opts.max) break;
    }
    return ok(out);
  }

  /** fixtures/github/_orgs/<org>.teams.json: [{ slug, name, privacy, description, repos }]. */
  private async teamsFixture(org: string): Promise<TeamFixture[] | null> {
    try {
      const text = await readFile(join(this.fixturesDir, '_orgs', `${org}.teams.json`), 'utf8');
      return JSON.parse(text) as TeamFixture[];
    } catch {
      return null;
    }
  }

  async listOrgTeams(
    org: string,
    opts: { max: number },
  ): Promise<ProviderResult<{ teams: TeamDTO[]; limitReached: boolean }>> {
    const f = await this.teamsFixture(org);
    if (!f) return fail(NOT_FOUND);
    const teams = f.map((t) => ({ org, slug: t.slug, name: t.name, privacy: t.privacy }));
    return ok({ teams: teams.slice(0, opts.max), limitReached: teams.length > opts.max });
  }

  async listTeamRepositories(
    org: string,
    teamSlug: string,
  ): Promise<ProviderResult<TeamRepositoryDTO[]>> {
    const team = (await this.teamsFixture(org))?.find((t) => t.slug === teamSlug);
    if (!team) return fail(NOT_FOUND);
    if (team.$error) return fail(team.$error);
    return ok(team.repos.map((r) => ({ fullName: r.fullName, permission: r.permission })));
  }

  listDirectory(repo: string, path: string, _ref?: string) {
    return this.pick<DirectoryEntryDTO[]>(repo, (f) => f.directories?.[path]);
  }

  getBranchRules(repo: string, _branch: string) {
    return this.pick<BranchRuleDTO[]>(repo, (f) => f.branchRules, ok([]));
  }

  getClassicBranchProtection(repo: string, _branch: string) {
    return this.pick<ClassicProtectionDTO | null>(repo, (f) => f.classicProtection, ok(null));
  }

  getLatestScorecardAnalysis(repo: string) {
    return this.pick<CodeScanningAnalysisDTO | null>(repo, (f) => f.scorecardAnalysis, ok(null));
  }

  getCustomPropertyValues(repo: string) {
    return this.pick<CustomPropertyDTO[]>(repo, (f) => f.customProperties, ok([]));
  }

  listWorkflows(repo: string) {
    return this.pick<WorkflowDTO[]>(repo, (f) => f.workflows, ok([]));
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

  async getQualitySummary(repo: string): Promise<ProviderResult<QualitySummaryArtifactDTO>> {
    const r = await this.pick(repo, (f) => f.qualitySummary);
    if (!r.ok) return r;
    return ok({
      summaryText: r.data.expired ? null : JSON.stringify(r.data.summary),
      createdAt: r.data.createdAt,
      runUrl: `https://github.com/${repo}/actions/runs/${r.data.runId}`,
    });
  }

  listCodeQualityFindings(repo: string) {
    return this.pick(repo, (f) => f.codeQualityFindings);
  }

  async requestDependencySbom(repo: string): Promise<ProviderResult<SbomRequestDTO>> {
    const r = await this.pick(repo, (f) => f.dependencySbom, notEnabled());
    return r.ok ? ok({ uuid: MOCK_SBOM_UUID }) : r;
  }

  async fetchDependencySbom(repo: string, _uuid: string): Promise<ProviderResult<SbomFetchDTO>> {
    const r = await this.pick(repo, (f) => f.dependencySbom, notEnabled());
    if (!r.ok) return r;
    if ('pending' in r.data) return ok({ state: 'pending' });
    const document = 'expand' in r.data ? spdxFromExpand(r.data.expand) : r.data.document;
    return ok({ state: 'ready', text: JSON.stringify(document) });
  }
}
