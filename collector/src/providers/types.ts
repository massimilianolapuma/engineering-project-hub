import type { AuthenticationMode, DataSource, ErrorClassification } from '@model/index';

/** A workflow file name under `.github/workflows/` that the collector may read. */
export const WORKFLOW_FILE = /^[A-Za-z0-9._-]+\.ya?ml$/;
/** Published bound of a workflow file name (snapshot schema). */
export const MAX_WORKFLOW_FILE_NAME = 100;

/*
 * Provider-neutral DTOs. Providers project API responses onto these minimal shapes
 * (allowlist): raw payloads never leave the provider layer.
 */

/** A team's access level on a repository (GitHub role names, pull → read, push → write). */
export type TeamPermission = 'read' | 'triage' | 'write' | 'maintain' | 'admin';
/** An organisation team: slug, name and privacy only (never description or members). */
export interface TeamDTO {
  org: string;
  slug: string;
  name: string;
  privacy: 'closed' | 'secret';
}
/** A repository a team can access; permission null when GitHub does not say. */
export interface TeamRepositoryDTO {
  fullName: string;
  permission: TeamPermission | null;
}

export interface RepositoryDTO {
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  visibility: 'public' | 'private' | 'internal';
  defaultBranch: string;
  archived: boolean;
  updatedAt: string | null;
  topics: string[];
  fork?: boolean;
}

export interface DirectoryEntryDTO {
  name: string;
  type: 'file' | 'dir' | 'submodule' | 'symlink';
}

export interface WorkflowDTO {
  /** File name in .github/workflows (e.g. ci.yml). */
  file: string;
  name: string;
}

export interface CommitRefDTO {
  sha: string;
  htmlUrl: string | null;
  committedAt: string | null;
  /** The branch's `protected` flag; null when the API does not report it. */
  protected?: boolean | null;
}

/** One active rule applying to a branch (rulesets). Parameters other than the approval count are dropped. */
export interface BranchRuleDTO {
  type: string;
  requiredApprovals: number | null;
}

/** Classic branch protection, reduced to the booleans the repository checks need. */
export interface ClassicProtectionDTO {
  pullRequestReviews: boolean;
  requiredApprovals: number | null;
  statusChecks: boolean;
  forcePushBlocked: boolean;
  deletionBlocked: boolean;
}

export interface CustomPropertyDTO {
  name: string;
  value: string | string[] | null;
}

/** A release asset: name and digest only (never the download URL). */
export interface ReleaseAssetDTO {
  name: string;
  /** Kept only when it matches /^sha256:[0-9a-f]{64}$/. */
  digest: string | null;
}

export interface ReleaseDTO {
  tagName: string;
  name: string | null;
  publishedAt: string | null;
  prerelease: boolean;
  htmlUrl: string;
  assets: ReleaseAssetDTO[];
}

export interface TagDTO {
  name: string;
  sha: string;
}

/** Result of comparing two commits (base...head). */
export interface CompareDTO {
  status: 'ahead' | 'behind' | 'identical' | 'diverged';
  aheadBy: number;
  behindBy: number;
}

export interface FileDTO {
  /** Decoded text. Only parsed by the collector; never published. */
  text: string;
}

export interface SubmoduleRefDTO {
  path: string;
  sha: string;
}

export interface WorkflowRunDTO {
  id: number;
  runNumber: number;
  runAttempt: number;
  status: string;
  conclusion: string | null;
  headBranch: string | null;
  event: string;
  headSha: string | null;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

/** Name of the failed job / step of a run. Logs are never fetched. */
export interface RunFailureDTO {
  jobName: string | null;
  stepName: string | null;
}

export interface CodeScanningAlertDTO {
  number: number;
  state: string;
  dismissedReason: string | null;
  ruleId: string | null;
  ruleSeverity: string | null;
  securitySeverityLevel: string | null;
  ruleDescription: string | null;
  toolName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  htmlUrl: string;
  /** File of the most recent instance; used only to attribute the alert to a monorepo component. */
  path?: string | null;
  /** most_recent_instance.category: tells apart tools mapped to several controls (e.g. Trivy). */
  category?: string | null;
}

export interface CodeScanningAnalysisDTO {
  createdAt: string;
  toolName: string | null;
  category?: string | null;
}

/** Whether attestations exist for a digest. The bundle is never read into the DTO. */
export interface AttestationPresenceDTO {
  provenance: boolean;
  sbom: boolean;
}

export interface DependabotAlertDTO {
  number: number;
  state: string;
  dismissedReason: string | null;
  ghsaId: string | null;
  cveId: string | null;
  severity: string | null;
  summary: string | null;
  packageName: string | null;
  firstPatchedVersion: string | null;
  /** Manifest declaring the dependency; used only to attribute the alert to a monorepo component. */
  manifestPath?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  htmlUrl: string;
}

/**
 * Deliberately has NO field for the secret value, its location, the file, the commit or any
 * snippet. Providers must not request or keep them.
 */
export interface SecretScanningAlertDTO {
  number: number;
  state: string;
  resolution: string | null;
  secretTypeDisplayName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  htmlUrl: string;
}

export interface QualitySummaryArtifactDTO {
  /** null when the newest default-branch artifact has expired and no live one exists. */
  summaryText: string | null;
  createdAt: string | null;
  runUrl: string | null;
}

/** Result of asking GitHub to generate the dependency-graph SBOM report. */
export interface SbomRequestDTO {
  uuid: string;
}

/** `ready` carries the downloaded SPDX text: parsed and dropped by the collector, never published. */
export type SbomFetchDTO = { state: 'pending' } | { state: 'ready'; text: string };

export interface SupplyChainSummaryArtifactDTO {
  /** null when the newest default-branch artifact has expired and no live one exists. */
  summaryText: string | null;
  createdAt: string | null;
  runUrl: string | null;
}

export interface CodeQualityFindingDTO {
  category: string;
  severity: string;
}

export interface ProviderError {
  classification: ErrorClassification;
  httpStatus?: number;
  /** Short provider message. Sanitised again before publication. */
  message?: string;
  /**
   * Call not made because the repository itself is not accessible. Such results mean
   * "unknown" (never "absent"), are not reported as separate collection errors and do not
   * count towards capability availability.
   */
  skipped?: boolean;
  /**
   * The call answered but the result was too large to read in full (page cap). The
   * permission works; only the data is unknown.
   */
  incomplete?: boolean;
}

export type ProviderResult<T> = { ok: true; data: T } | { ok: false; error: ProviderError };

export const ok = <T>(data: T): ProviderResult<T> => ({ ok: true, data });
export const fail = <T = never>(error: ProviderError): ProviderResult<T> => ({ ok: false, error });

/**
 * Source of repository data. MVP implementations: GitHub (REST) and mock (fixtures).
 * Future providers (Harbor, SonarQube, Argo CD, Azure DevOps, ...) will implement narrower
 * interfaces (see ControlProvider) and be merged by the collector.
 */
export interface SourceProvider {
  readonly dataSource: DataSource;
  readonly authenticationMode: AuthenticationMode;
  getRepository(repo: string): Promise<ProviderResult<RepositoryDTO>>;
  /** Discovery: repositories of an owner (organisation or user); public only unless asked. */
  listOwnerRepositories(
    owner: string,
    opts: { includePrivate: boolean; max: number },
  ): Promise<ProviderResult<RepositoryDTO[]>>;
  /** Team discovery (Members: read): an organisation's teams, at most `max`. 404 = not an organisation. */
  listOrgTeams(
    org: string,
    opts: { max: number },
  ): Promise<ProviderResult<{ teams: TeamDTO[]; limitReached: boolean }>>;
  /** Team discovery: the repositories a team can access, with the team's permission. */
  listTeamRepositories(org: string, teamSlug: string): Promise<ProviderResult<TeamRepositoryDTO[]>>;
  /** Discovery: entries of a directory ("" = repository root) at an optional ref. Names only, never contents. */
  listDirectory(
    repo: string,
    path: string,
    ref?: string,
  ): Promise<ProviderResult<DirectoryEntryDTO[]>>;
  /** Discovery: workflows defined in the repository. */
  listWorkflows(repo: string): Promise<ProviderResult<WorkflowDTO[]>>;
  getBranchHead(repo: string, branch: string): Promise<ProviderResult<CommitRefDTO>>;
  getLatestRelease(repo: string): Promise<ProviderResult<ReleaseDTO>>;
  getLatestTag(repo: string): Promise<ProviderResult<TagDTO>>;
  /** Most recent tags (name + commit SHA), bounded; used to resolve submodule SHAs to versions. */
  listTags(repo: string): Promise<ProviderResult<TagDTO[]>>;
  /** Compares base...head (e.g. latest release tag ... submodule SHA). */
  compareCommits(repo: string, base: string, head: string): Promise<ProviderResult<CompareDTO>>;
  /**
   * Only called with allow-listed paths (.gitmodules, release manifest, security status file,
   * `.github/workflows/<name>` where `<name>` matches WORKFLOW_FILE).
   */
  getFile(repo: string, path: string, ref?: string): Promise<ProviderResult<FileDTO>>;
  getSubmoduleRef(
    repo: string,
    path: string,
    ref?: string,
  ): Promise<ProviderResult<SubmoduleRefDTO>>;
  listWorkflowRuns(
    repo: string,
    workflowFile: string,
    branch?: string,
  ): Promise<ProviderResult<WorkflowRunDTO[]>>;
  getRunFailure(repo: string, runId: number): Promise<ProviderResult<RunFailureDTO | null>>;
  listCodeScanningAlerts(repo: string): Promise<ProviderResult<CodeScanningAlertDTO[]>>;
  getLatestCodeScanningAnalysis(
    repo: string,
  ): Promise<ProviderResult<CodeScanningAnalysisDTO | null>>;
  /** Rules of active rulesets applying to the branch (1 page of 100). */
  getBranchRules(repo: string, branch: string): Promise<ProviderResult<BranchRuleDTO[]>>;
  /** Classic protection; only called when policies.repositoryControls.readClassicProtection. 404 → ok(null). */
  getClassicBranchProtection(
    repo: string,
    branch: string,
  ): Promise<ProviderResult<ClassicProtectionDTO | null>>;
  /** Newest OpenSSF Scorecard analysis (code scanning analyses filtered by tool). */
  getLatestScorecardAnalysis(repo: string): Promise<ProviderResult<CodeScanningAnalysisDTO | null>>;
  /** Discovery: custom property values. The consumer keeps only the configured keys. */
  getCustomPropertyValues(repo: string): Promise<ProviderResult<CustomPropertyDTO[]>>;
  listDependabotAlerts(repo: string): Promise<ProviderResult<DependabotAlertDTO[]>>;
  listSecretScanningAlerts(repo: string): Promise<ProviderResult<SecretScanningAlertDTO[]>>;
  /** Newest `hub-quality-summary` artifact of a branch, unzipped to the summary JSON text. */
  getQualitySummary(
    repo: string,
    branch: string,
  ): Promise<ProviderResult<QualitySummaryArtifactDTO>>;
  listCodeQualityFindings(repo: string): Promise<ProviderResult<CodeQualityFindingDTO[]>>;
  /** Code scanning analyses of one tool on a ref (a branch name or refs/heads/<branch>), newest first, up to 10. */
  listCodeScanningAnalyses(
    repo: string,
    tool: string,
    ref: string,
  ): Promise<ProviderResult<CodeScanningAnalysisDTO[]>>;
  /** Presence of provenance / SBOM attestations for a `sha256:` digest (never verified here). */
  getAttestationPresence(
    repo: string,
    digest: string,
  ): Promise<ProviderResult<AttestationPresenceDTO>>;
  /** Newest `hub-supply-chain-summary` artifact of a branch, unzipped to the summary JSON text. */
  getSupplyChainSummary(
    repo: string,
    branch: string,
  ): Promise<ProviderResult<SupplyChainSummaryArtifactDTO>>;
  /**
   * Asks GitHub to generate the dependency-graph SBOM (GET .../sbom/generate-report): the single
   * call that makes GitHub run a job (ADR 0009). Only called when the owner opted in.
   */
  requestDependencySbom(repo: string): Promise<ProviderResult<SbomRequestDTO>>;
  /** Polls the report: 202 → pending; 302 → the SPDX text, downloaded from an allow-listed host. */
  fetchDependencySbom(repo: string, uuid: string): Promise<ProviderResult<SbomFetchDTO>>;
}

/**
 * Extension point for non-GitHub security / delivery sources (roadmap). A control provider
 * returns normalised control results for one repository; the MVP reads the equivalent data
 * from `.security/project-security-status.json` instead.
 */
export interface ControlProvider {
  readonly id: string;
  supports(control: string): boolean;
}
