import { z } from 'zod';
import { ExceptionSourceSchema, ExceptionStateSchema } from './exceptions';
import { CatalogSchema, ProjectConfigSchema, VersionSourceSchema } from './catalog';
import {
  AuthenticationModeSchema,
  AvailabilitySchema,
  BranchRuleTypeSchema,
  CapabilitySchema,
  ComponentTypeSchema,
  ControlIdSchema,
  ControlStateSchema,
  DataSourceSchema,
  ErrorClassificationSchema,
  FindingCategorySchema,
  FindingSourceSchema,
  FindingStatusSchema,
  HealthResultSchema,
  HealthStatusSchema,
  LifecycleSchema,
  ReasonSchema,
  RepositoryCheckIdSchema,
  RepositoryCheckStateSchema,
  ScorecardCheckSchema,
  SeveritySchema,
  SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS,
} from './enums';
import { httpsUrl, isoDate, nullableCount, shortText } from './primitives';

/*
 * Normalised, provider-neutral snapshot model. Every object is `.strict()`: unknown keys are
 * rejected, which turns these schemas into the publication allowlist. Nothing outside this
 * model can reach GitHub Pages.
 */

const sha = z.string().regex(/^[0-9a-f]{40}$/);

export const SchemaVersionSchema = z.enum(SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS);

export const CollectionErrorSchema = z
  .object({
    repository: z.string().max(200),
    componentId: z.string().max(64).optional(),
    source: z.enum([
      'repository',
      'branch',
      'release',
      'tag',
      'manifest',
      'gitmodules',
      'submodule',
      'workflow-runs',
      'code-scanning',
      'dependabot',
      'secret-scanning',
      'security-status-file',
      'quality-summary',
      'code-quality',
      'workflow-files',
      'repository-rules',
      'scorecard-analysis',
    ]),
    classification: ErrorClassificationSchema,
    httpStatus: z.number().int().min(100).max(599).optional(),
    /** Sanitised, truncated provider message. Never a raw payload or stack trace. */
    detail: shortText.optional(),
  })
  .strict();
export type CollectionError = z.infer<typeof CollectionErrorSchema>;

export const RepositoryInfoSchema = z
  .object({
    fullName: z.string().max(200),
    owner: z.string().max(100),
    name: z.string().max(100),
    url: httpsUrl.nullable(),
    /** ok = metadata collected; otherwise the classification of the failure. */
    status: z.enum(['ok', 'not-found', 'not-authorised', 'rate-limited', 'error']),
    visibility: z.enum(['public', 'private', 'internal', 'unknown']),
    defaultBranch: z.string().max(255).nullable(),
    configuredDefaultBranch: z.string().max(255).nullable(),
    archived: z.boolean().nullable(),
    updatedAt: isoDate.nullable(),
    topics: z.array(z.string().max(50)).max(30),
    latestCommit: z
      .object({ sha, url: httpsUrl.nullable(), committedAt: isoDate.nullable() })
      .strict()
      .nullable(),
  })
  .strict();
export type RepositoryInfo = z.infer<typeof RepositoryInfoSchema>;

export const ReleaseInfoSchema = z
  .object({
    tag: z.string().max(100),
    name: shortText.nullable(),
    publishedAt: isoDate.nullable(),
    prerelease: z.boolean(),
    url: httpsUrl.nullable(),
    /** "release" = GitHub Release; "tag" = fallback to the latest tag. */
    kind: z.enum(['release', 'tag']),
  })
  .strict();
export type ReleaseInfo = z.infer<typeof ReleaseInfoSchema>;

export const SubmoduleSchema = z
  .object({
    path: z.string().max(255),
    /** Remote reduced to "owner/name" when it is a GitHub URL; otherwise null (not published). */
    repository: z.string().max(200).nullable(),
    sha: sha.nullable(),
    componentId: z.string().max(64).nullable(),
    association: z.enum(['configured-path', 'repository-url', 'unmapped']),
    status: z.enum(['resolved', 'unresolvable', 'unknown']),
  })
  .strict();
export type Submodule = z.infer<typeof SubmoduleSchema>;

export const WorkflowRunSchema = z
  .object({
    id: z.number().int(),
    runNumber: z.number().int(),
    runAttempt: z.number().int(),
    status: z.string().max(30),
    conclusion: z.string().max(30).nullable(),
    branch: z.string().max(255).nullable(),
    event: z.string().max(50),
    sha: sha.nullable(),
    createdAt: isoDate,
    updatedAt: isoDate,
    url: httpsUrl.nullable(),
  })
  .strict();
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export const WorkflowStateSchema = z.enum([
  'success',
  'failure',
  'cancelled',
  'in-progress',
  'queued',
  'never-run',
  'missing',
  'not-authorised',
  'unknown',
]);
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

export const WorkflowStatusSchema = z
  .object({
    workflowId: z.string().max(64),
    name: z.string().max(100),
    file: z.string().max(100),
    critical: z.boolean(),
    componentId: z.string().max(64),
    repository: z.string().max(200),
    branch: z.string().max(255).nullable(),
    state: WorkflowStateSchema,
    stale: z.boolean(),
    latestRun: WorkflowRunSchema.nullable(),
    lastCompletedRun: WorkflowRunSchema.nullable(),
    lastFailedRun: WorkflowRunSchema.nullable(),
    activeRun: WorkflowRunSchema.nullable(),
    /** Short, sanitised summary of the last failure (no logs are ever collected). */
    lastError: shortText.nullable(),
  })
  .strict();
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const SeverityCountsSchema = z
  .object({
    critical: nullableCount,
    high: nullableCount,
    medium: nullableCount,
    low: nullableCount,
    informational: nullableCount,
    unknown: nullableCount,
  })
  .strict();
export type SeverityCounts = z.infer<typeof SeverityCountsSchema>;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Standalone risk-governance schemas (spec 5.6). Attached to findings, summaries and the run
 * metadata below.
 */
export const FindingExceptionSchema = z
  .object({
    id: z.string().max(40),
    state: z.enum(['active', 'expired']),
    expires: day,
  })
  .strict();
export type FindingException = z.infer<typeof FindingExceptionSchema>;

export const FindingSlaSchema = z
  .object({
    state: z.enum(['within', 'overdue', 'paused', 'none', 'unknown']),
    days: z.number().int().min(1).nullable(),
    dueAt: isoDate.nullable(),
    ageDays: z.number().int().min(0).nullable(),
    overdueDays: z.number().int().min(0).nullable(),
  })
  .strict();
export type FindingSla = z.infer<typeof FindingSlaSchema>;

export const SecurityExceptionSchema = z
  .object({
    id: z.string().max(40),
    repository: z.string().max(200),
    source: ExceptionSourceSchema,
    selector: z
      .object({
        kind: z.enum(['alert', 'rule', 'advisory']),
        /** null = withheld (non-public repository under a public audience). */
        value: z.string().max(200).nullable(),
        tool: z.string().max(50).nullable(),
      })
      .strict(),
    owner: z.string().max(65),
    /** null = withheld. */
    reason: shortText.nullable(),
    created: day,
    expires: day,
    ticketUrl: httpsUrl.nullable(),
    state: ExceptionStateSchema,
    expiringSoon: z.boolean(),
    /** null when unverifiable. */
    matched: nullableCount,
    findingIds: z.array(z.string().max(200)).max(50),
  })
  .strict();
export type SecurityException = z.infer<typeof SecurityExceptionSchema>;

const slaClassCounts = <T extends z.ZodType>(value: T) =>
  z
    .object({
      critical: value,
      high: value,
      medium: value,
      low: value,
      secret: value,
    })
    .strict();

export const RemediationSummarySchema = z
  .object({
    enabled: z.boolean(),
    /** Echo of the policy, so the site never reads policies to label a row. */
    slaDays: slaClassCounts(z.number().int().min(1).nullable()),
    overdue: slaClassCounts(nullableCount),
    oldestOverdueSince: isoDate.nullable(),
    slaUnknown: z.number().int().min(0),
  })
  .strict();
export type RemediationSummary = z.infer<typeof RemediationSummarySchema>;

export const ExceptionStatesSchema = z
  .object({
    active: z.number().int().min(0),
    expired: z.number().int().min(0),
    stale: z.number().int().min(0),
    unverifiable: z.number().int().min(0),
    /** created in the future: never applied. */
    invalid: z.number().int().min(0),
    expiringSoon: z.number().int().min(0),
  })
  .strict();
export type ExceptionStates = z.infer<typeof ExceptionStatesSchema>;

export const ProjectRiskSchema = z
  .object({
    /** Sum of the five overdue classes. */
    overdue: nullableCount,
    overdueCriticalHigh: nullableCount,
    /** Sum of acceptedCounts. */
    accepted: nullableCount,
    /** expired + stale + unverifiable + invalid. */
    exceptionIssues: z.number().int().min(0),
  })
  .strict();
export type ProjectRisk = z.infer<typeof ProjectRiskSchema>;

export const RunExceptionsSchema = z
  .object({
    source: z.enum(['config', 'fixture', 'none']),
    total: z.number().int().min(0),
    /** Ids only, never the repository. */
    orphaned: z.array(z.string().max(40)).max(100),
  })
  .strict();
export type RunExceptions = z.infer<typeof RunExceptionsSchema>;

export const SecurityFindingSchema = z
  .object({
    id: z.string().max(200),
    projectId: z.string().max(64),
    componentId: z.string().max(64),
    repository: z.string().max(200),
    source: FindingSourceSchema,
    category: FindingCategorySchema,
    severity: SeveritySchema,
    originalSeverity: z.string().max(50).nullable(),
    status: FindingStatusSchema,
    originalStatus: z.string().max(50).nullable(),
    ruleId: z.string().max(200).nullable(),
    /** Sanitised title; null when withheld by the publication policy. */
    title: shortText.nullable(),
    environment: z.string().max(64).optional(),
    version: z.string().max(100).optional(),
    commitSha: sha.optional(),
    detectedAt: isoDate.nullable(),
    updatedAt: isoDate.nullable(),
    fixAvailable: z.boolean().nullable(),
    htmlUrl: httpsUrl.nullable(),
    tool: z.string().max(50).nullable(),
    repositoryPrivate: z.boolean().nullable(),
    dataClassification: z.enum(['public', 'internal', 'restricted']),
    /** The exception accepting (or that accepted) this finding; status stays the GitHub truth. */
    exception: FindingExceptionSchema.nullable(),
    /** Remediation SLA of an open GitHub finding; null otherwise or when SLAs are off. */
    sla: FindingSlaSchema.nullable(),
  })
  .strict();
export type SecurityFinding = z.infer<typeof SecurityFindingSchema>;

export const ControlStatusSchema = z
  .object({
    control: ControlIdSchema,
    required: z.boolean(),
    state: ControlStateSchema,
    tool: z.string().max(50).nullable(),
    lastScanAt: isoDate.nullable(),
    counts: SeverityCountsSchema.nullable(),
    reportUrl: httpsUrl.nullable(),
  })
  .strict();
export type ControlStatus = z.infer<typeof ControlStatusSchema>;

export const RepositoryControlsSchema = z
  .object({
    componentId: z.string().max(64),
    repository: z.string().max(200),
    controls: z.array(ControlStatusSchema),
  })
  .strict();
export type RepositoryControls = z.infer<typeof RepositoryControlsSchema>;

export const CoverageSummarySchema = z
  .object({
    status: HealthStatusSchema,
    reasons: z.array(ReasonSchema),
    /** Percentage of required controls available everywhere; null when nothing is required. */
    percentage: z.number().min(0).max(100).nullable(),
    required: z.number().int().min(0),
    available: z.number().int().min(0),
    notConfigured: z.number().int().min(0),
    notAuthorised: z.number().int().min(0),
    unknown: z.number().int().min(0),
    failed: z.number().int().min(0),
    stale: z.number().int().min(0),
    collectedAt: isoDate,
    perControl: z.array(
      z
        .object({ control: ControlIdSchema, required: z.boolean(), state: ControlStateSchema })
        .strict(),
    ),
  })
  .strict();
export type CoverageSummary = z.infer<typeof CoverageSummarySchema>;

export const SecuritySummarySchema = HealthResultSchema.extend({
  openCounts: SeverityCountsSchema,
  /** Open findings accepted by an active exception, by severity (null = not measured). */
  acceptedCounts: SeverityCountsSchema,
  remediation: RemediationSummarySchema,
  exceptionStates: ExceptionStatesSchema,
  /** false when at least one alert source could not be read: counts are a lower bound. */
  countsComplete: z.boolean(),
  openSecretAlerts: nullableCount,
  byCategory: z.record(FindingCategorySchema, z.number().int().min(0)),
  bySource: z.record(FindingSourceSchema, z.number().int().min(0)),
}).strict();
export type SecuritySummary = z.infer<typeof SecuritySummarySchema>;

/**
 * State of a component's quality report. readable / stale are counted; missing, expired,
 * invalid, not-authorised and unknown are "not visible" and never count as 0%.
 */
export const QualityReportStateSchema = z.enum([
  'readable',
  'stale',
  'missing',
  'expired',
  'invalid',
  'not-authorised',
  'unknown',
  'not-applicable',
]);
export type QualityReportState = z.infer<typeof QualityReportStateSchema>;

const percentage = z.number().min(0).max(100);

export const QualityHealthSchema = HealthResultSchema.extend({
  /** Σ covered / Σ valid over unique repositories with a readable or stale report (1 decimal). */
  percentage: percentage.nullable(),
  linesCovered: z.number().int().min(0),
  linesValid: z.number().int().min(0),
  /** Component counts: measured (readable or stale) out of applicable. */
  measured: z.number().int().min(0),
  applicable: z.number().int().min(0),
  notVisible: z.number().int().min(0),
  stale: z.number().int().min(0),
  collectedAt: isoDate,
  perComponent: z.array(
    z
      .object({
        componentId: z.string().max(64),
        state: QualityReportStateSchema,
        /** The repository (and so this report) is shared with other components. */
        sharedRepository: z.boolean(),
        percentage: percentage.nullable(),
        linesCovered: nullableCount,
        linesValid: nullableCount,
        commitSha: sha.nullable(),
        generatedAt: isoDate.nullable(),
        tool: z.string().max(40).nullable(),
        runUrl: httpsUrl.nullable(),
      })
      .strict(),
  ),
  /** GitHub Code Quality open findings, counted once per repository. Informative only. */
  findings: z
    .object({
      state: z.enum(['available', 'not-configured', 'not-authorised', 'unknown']),
      reliability: nullableCount,
      maintainability: nullableCount,
      bySeverity: z
        .object({
          error: nullableCount,
          warning: nullableCount,
          note: nullableCount,
          none: nullableCount,
        })
        .strict(),
    })
    .strict(),
}).strict();
export type QualityHealth = z.infer<typeof QualityHealthSchema>;

const WORKFLOW_FILE_NAME = z
  .string()
  .max(100)
  .regex(/^[A-Za-z0-9._-]+\.ya?ml$/);
const checkLevel = z.enum(['info', 'amber', 'red']);
const intCount = z.number().int().min(0);
const percent = z.number().int().min(0).max(100).nullable();

/**
 * Repository controls (Governance): six named checks per unique repository, built from workflow
 * files and the branch rules API. Workflow text is never published: only identifiers rebuilt
 * from validated parts, refs and workflow file names.
 */
export const RepositoryControlsHealthSchema = z
  .object({
    enabled: z.boolean(),
    collectedAt: isoDate,
    /** Counts over unique repositories x checks. */
    passed: intCount,
    failed: intCount,
    unknown: intCount,
    notApplicable: intCount,
    ratio: percent,
    perCheck: z
      .array(
        z
          .object({
            id: RepositoryCheckIdSchema,
            level: checkLevel,
            passed: intCount,
            failed: intCount,
            unknown: intCount,
            notApplicable: intCount,
          })
          .strict(),
      )
      .length(6),
    repositories: z.array(
      z
        .object({
          /** Monorepo: every target on the repository. */
          componentIds: z.array(z.string().max(64)).min(1),
          repository: z.string().max(200),
          checks: z
            .array(
              z.object({ id: RepositoryCheckIdSchema, state: RepositoryCheckStateSchema }).strict(),
            )
            .length(6),
          passed: intCount,
          failed: intCount,
          unknown: intCount,
          notApplicable: intCount,
          ratio: percent,
          actions: z
            .object({
              state: z.enum(['available', 'partial', 'none', 'not-authorised', 'unknown']),
              workflowFiles: nullableCount,
              total: nullableCount,
              pinned: nullableCount,
              unpinned: nullableCount,
              unknown: nullableCount,
              /** Identifiers withheld (non-public repository, public audience). Counts stay. */
              detailsWithheld: z.boolean(),
              unpinnedRefs: z
                .array(
                  z
                    .object({
                      workflow: WORKFLOW_FILE_NAME,
                      kind: z.enum(['action', 'reusable-workflow', 'docker']),
                      target: z.string().max(200),
                      ref: z.string().max(100),
                    })
                    .strict(),
                )
                .max(20),
              truncated: intCount,
            })
            .strict(),
          reusableWorkflows: z
            .array(
              z
                .object({
                  workflow: WORKFLOW_FILE_NAME,
                  target: z.string().max(250),
                  ref: z.string().max(100),
                  latest: z.string().max(100).nullable(),
                  status: z.enum(['current', 'behind', 'untagged', 'floating', 'unknown']),
                  /** The referenced repository. */
                  url: httpsUrl.nullable(),
                })
                .strict(),
            )
            .max(20),
          branchRules: z
            .object({
              state: z.enum(['available', 'not-authorised', 'unknown']),
              branch: z.string().max(255).nullable(),
              protected: z.boolean().nullable(),
              source: z.enum(['rulesets', 'classic', 'both', 'none', 'unknown']),
              ruleTypes: z.array(BranchRuleTypeSchema).max(30),
              otherRules: intCount,
              requiredApprovals: z.number().int().min(0).max(10).nullable(),
              classicRead: z.boolean(),
            })
            .strict(),
          scorecard: z
            .object({
              state: z.enum(['available', 'not-used', 'not-authorised', 'unknown']),
              lastAnalysisAt: isoDate.nullable(),
              openAlerts: nullableCount,
              failingChecks: z.array(ScorecardCheckSchema).max(20),
              otherFailing: intCount,
            })
            .strict(),
        })
        .strict(),
    ),
  })
  .strict();
export type RepositoryControlsHealth = z.infer<typeof RepositoryControlsHealthSchema>;

/**
 * What the SHA pinned by the coordinator corresponds to in the component repository:
 * - tagged: the SHA is exactly a tag (verified version)
 * - ahead / behind / diverged: not tagged; position relative to the latest release
 * - unknown: SHA, tags or comparison not available
 */
export const PinSchema = z
  .object({
    status: z.enum(['tagged', 'ahead', 'behind', 'diverged', 'unknown']),
    tag: z.string().max(100).nullable(),
    version: z.string().max(100).nullable(),
    comparedTo: z.string().max(100).nullable(),
    aheadBy: z.number().int().min(0).nullable(),
    behindBy: z.number().int().min(0).nullable(),
  })
  .strict();
export type Pin = z.infer<typeof PinSchema>;

export const ComponentSnapshotSchema = z
  .object({
    id: z.string().max(64),
    name: z.string().max(100),
    type: ComponentTypeSchema,
    repository: RepositoryInfoSchema,
    /** Directory inside the repository (monorepo components); null for whole repositories. */
    path: z.string().max(255).nullable(),
    /** Configured source of the current version (catalog `versionSource`). */
    versionSource: VersionSourceSchema,
    /** Version declared in the coordinator's release manifest. */
    declaredVersion: z.string().max(100).nullable(),
    latestRelease: ReleaseInfoSchema.nullable(),
    submodule: SubmoduleSchema.nullable(),
    /** Resolution of the submodule SHA; null when the component is not a submodule. */
    pin: PinSchema.nullable(),
    /** Current version according to versionSource, and where it actually came from. */
    effectiveVersion: z.string().max(100).nullable(),
    effectiveVersionSource: z.enum(['submodule', 'manifest', 'release', 'unknown']),
    /** Manifest declaration vs version pinned by the submodule. */
    manifestConsistency: z.enum(['consistent', 'mismatch', 'unknown']),
    /** Effective version vs latest release. */
    drift: z.enum(['aligned', 'drift', 'unknown']),
  })
  .strict();
export type ComponentSnapshot = z.infer<typeof ComponentSnapshotSchema>;

export const EnvironmentSnapshotSchema = z
  .object({
    id: z.string().max(64),
    name: z.string().max(50),
    version: z.string().max(100).nullable(),
    source: z.enum(['manifest', 'unknown']),
    status: z.enum(['aligned', 'behind', 'mismatch', 'unknown']),
  })
  .strict();
export type EnvironmentSnapshot = z.infer<typeof EnvironmentSnapshotSchema>;

/**
 * Project score computed by the collector. value is null when too few required dimensions
 * could be measured ("insufficient data"); measured / required is the confidence.
 */
export const ProjectScoreSchema = z
  .object({
    value: z.number().int().min(0).max(100).nullable(),
    measured: z.number().int().min(0),
    required: z.number().int().min(0),
  })
  .strict();
export type ProjectScore = z.infer<typeof ProjectScoreSchema>;

export const ProjectSnapshotSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    generatedAt: isoDate,
    project: z
      .object({
        id: z.string().max(64),
        name: z.string().max(100),
        description: z.string().max(500),
        businessUnit: z.string().max(100),
        lifecycle: LifecycleSchema,
      })
      .strict(),
    coordinator: z
      .object({
        repository: RepositoryInfoSchema,
        version: z.string().max(100).nullable(),
        versionSource: z.enum(['manifest', 'release', 'tag', 'unknown']),
        latestRelease: ReleaseInfoSchema.nullable(),
        manifest: z
          .object({
            path: z.string().max(255),
            status: z.enum(['ok', 'missing', 'invalid', 'not-authorised', 'unknown']),
          })
          .strict(),
        submodules: z.array(SubmoduleSchema),
      })
      .strict(),
    components: z.array(ComponentSnapshotSchema),
    environments: z.array(EnvironmentSnapshotSchema),
    workflows: z.array(WorkflowStatusSchema),
    securityFindings: z.array(SecurityFindingSchema),
    /** Sorted by state (invalid, expired, unverifiable, stale, active), then id. */
    securityExceptions: z.array(SecurityExceptionSchema).max(500),
    securityControls: z.array(RepositoryControlsSchema),
    deliveryHealth: HealthResultSchema,
    versionHealth: HealthResultSchema,
    securityHealth: SecuritySummarySchema,
    securityCoverage: CoverageSummarySchema,
    governanceHealth: HealthResultSchema,
    qualityHealth: QualityHealthSchema,
    repositoryControls: RepositoryControlsHealthSchema,
    overallHealth: HealthResultSchema,
    score: ProjectScoreSchema,
    dataFreshness: z
      .object({
        status: HealthStatusSchema,
        collectedAt: isoDate,
        oldestSourceAt: isoDate.nullable(),
        staleSources: z.array(
          z
            .object({
              repository: z.string().max(200),
              source: z.enum([
                'workflow-runs',
                'code-scanning',
                'security-status-file',
                'quality-report',
              ]),
              lastUpdatedAt: isoDate.nullable(),
            })
            .strict(),
        ),
      })
      .strict(),
    collectionErrors: z.array(CollectionErrorSchema),
  })
  .strict();
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;

export const ProjectSummarySchema = z
  .object({
    id: z.string().max(64),
    name: z.string().max(100),
    businessUnit: z.string().max(100),
    lifecycle: LifecycleSchema,
    overall: HealthStatusSchema,
    score: ProjectScoreSchema,
    delivery: HealthStatusSchema,
    version: HealthStatusSchema,
    security: HealthStatusSchema,
    coverage: z
      .object({
        status: HealthStatusSchema,
        percentage: z.number().min(0).max(100).nullable(),
        required: z.number().int().min(0),
        available: z.number().int().min(0),
      })
      .strict(),
    governance: HealthStatusSchema,
    quality: z
      .object({
        status: HealthStatusSchema,
        percentage: z.number().min(0).max(100).nullable(),
        measured: z.number().int().min(0),
        applicable: z.number().int().min(0),
      })
      .strict(),
    /** Repository controls over unique repositories x checks. Informative: not a dimension. */
    repositoryControls: z
      .object({
        passed: intCount,
        failed: intCount,
        unknown: intCount,
        notApplicable: intCount,
        ratio: percent,
      })
      .strict(),
    freshness: HealthStatusSchema,
    openCounts: SeverityCountsSchema,
    risk: ProjectRiskSchema,
    countsComplete: z.boolean(),
    openSecretAlerts: nullableCount,
    /** Project-level secret scanning state, so "0" is never shown when it was not readable. */
    secretScanning: ControlStateSchema,
    failedCriticalWorkflows: nullableCount,
    collectedAt: isoDate,
    collectionErrorCount: z.number().int().min(0),
    unresolvedSubmodules: z.number().int().min(0),
  })
  .strict();
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const RunMetadataSchema = z
  .object({
    dataSource: DataSourceSchema,
    authenticationMode: AuthenticationModeSchema,
    collectorVersion: z.string().max(50),
    startedAt: isoDate,
    finishedAt: isoDate,
    durationMs: z.number().int().min(0),
    capabilities: z.record(CapabilitySchema, AvailabilitySchema),
    inaccessibleSources: z.array(
      z
        .object({
          repository: z.string().max(200),
          source: CollectionErrorSchema.shape.source,
          classification: ErrorClassificationSchema,
        })
        .strict(),
    ),
    repositories: z
      .object({
        total: z.number().int().min(0),
        ok: z.number().int().min(0),
        withErrors: z.number().int().min(0),
        unavailable: z.number().int().min(0),
      })
      .strict(),
    configValid: z.boolean(),
    exceptions: RunExceptionsSchema,
    policy: z
      .object({
        snapshotStaleHours: z.number().positive(),
        audience: z.enum(['public', 'restricted']),
      })
      .strict(),
  })
  .strict();
export type RunMetadata = z.infer<typeof RunMetadataSchema>;

export const PortfolioIndexSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    generatedAt: isoDate,
    run: RunMetadataSchema,
    projects: z.array(ProjectSummarySchema),
  })
  .strict();
export type PortfolioIndex = z.infer<typeof PortfolioIndexSchema>;

export const DiscoveryProposalSchema = z
  .object({
    /** coordinator: .gitmodules · monorepo: workspace manifest · grouped: repositories sharing a hinted project · single: one repository. */
    kind: z.enum(['coordinator', 'monorepo', 'grouped', 'single']),
    repository: z.string().max(200),
    url: httpsUrl.nullable(),
    /** Id of the catalog project that already uses this repository as coordinator. */
    projectId: z.string().max(64).nullable(),
    evidence: z.array(z.string().max(200)).max(20),
    /** Existing catalog project suggested by a hint when the repository is not part of it. */
    hintedProjectId: z.string().max(64).nullable(),
    /** The configured hint keys that were read (never any other property). */
    hints: z
      .array(
        z
          .object({
            source: z.enum(['property', 'topic']),
            key: z.string().max(50),
            value: z.string().max(100),
          })
          .strict(),
      )
      .max(10),
    /** Ready-to-edit project configuration proposed for the catalog. */
    project: ProjectConfigSchema,
  })
  .strict();
export type DiscoveryProposal = z.infer<typeof DiscoveryProposalSchema>;

export const DiscoveryResultSchema = z
  .object({
    owners: z.array(z.string().max(100)),
    scanned: z.number().int().min(0),
    proposals: z.array(DiscoveryProposalSchema),
    /** Repositories linked as submodules of a discovered coordinator. */
    claimed: z.array(
      z.object({ repository: z.string().max(200), by: z.string().max(200) }).strict(),
    ),
    errors: z.array(
      z.object({ target: z.string().max(200), classification: ErrorClassificationSchema }).strict(),
    ),
  })
  .strict();
export type DiscoveryResult = z.infer<typeof DiscoveryResultSchema>;

/**
 * catalog.json: the validated catalog as published by the collector, so the site (catalog
 * editor) never reads the YAML directly, plus link suggestions derived from collected data.
 */
export const CatalogSnapshotSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    generatedAt: isoDate,
    catalog: CatalogSchema,
    suggestions: z.array(
      z
        .object({
          projectId: z.string().max(64),
          /** .gitmodules entries of the coordinator not linked to any component. */
          unmappedSubmodules: z.array(
            z
              .object({ path: z.string().max(255), repository: z.string().max(200).nullable() })
              .strict(),
          ),
        })
        .strict(),
    ),
    /** Discovery proposals; null when discovery is disabled. */
    discovery: DiscoveryResultSchema.nullable(),
  })
  .strict();
export type CatalogSnapshot = z.infer<typeof CatalogSnapshotSchema>;

/** Header-only schema used to reject unsupported versions before full validation. */
export const VersionProbeSchema = z.object({ schemaVersion: z.string() });
