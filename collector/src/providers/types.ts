import type { AuthenticationMode, DataSource, ErrorClassification } from '@model/index';

/*
 * Provider-neutral DTOs. Providers project API responses onto these minimal shapes
 * (allowlist): raw payloads never leave the provider layer.
 */

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
}

export interface CommitRefDTO {
  sha: string;
  htmlUrl: string | null;
  committedAt: string | null;
}

export interface ReleaseDTO {
  tagName: string;
  name: string | null;
  publishedAt: string | null;
  prerelease: boolean;
  htmlUrl: string;
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
}

export interface CodeScanningAnalysisDTO {
  createdAt: string;
  toolName: string | null;
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

export interface ProviderError {
  classification: ErrorClassification;
  httpStatus?: number;
  /** Short provider message. Sanitised again before publication. */
  message?: string;
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
  getBranchHead(repo: string, branch: string): Promise<ProviderResult<CommitRefDTO>>;
  getLatestRelease(repo: string): Promise<ProviderResult<ReleaseDTO>>;
  getLatestTag(repo: string): Promise<ProviderResult<TagDTO>>;
  /** Most recent tags (name + commit SHA), bounded; used to resolve submodule SHAs to versions. */
  listTags(repo: string): Promise<ProviderResult<TagDTO[]>>;
  /** Compares base...head (e.g. latest release tag ... submodule SHA). */
  compareCommits(repo: string, base: string, head: string): Promise<ProviderResult<CompareDTO>>;
  /** Only called with allow-listed paths (.gitmodules, release manifest, security status file). */
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
  listDependabotAlerts(repo: string): Promise<ProviderResult<DependabotAlertDTO[]>>;
  listSecretScanningAlerts(repo: string): Promise<ProviderResult<SecretScanningAlertDTO[]>>;
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
