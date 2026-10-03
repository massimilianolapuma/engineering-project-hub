import { z } from 'zod';

/** Snapshot contract versions the site and validators understand. */
// 1.1: components carry the submodule pin (SHA → tag), versionSource and effective version.
// 1.2: component path (monorepos); catalog.json carries discovery settings and proposals.
export const SNAPSHOT_SCHEMA_VERSION = '1.2';
export const SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS = ['1.2'] as const;

export const HealthStatusSchema = z.enum(['green', 'amber', 'red', 'grey']);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

/** Ordering used to pick the "worst" status. grey is handled explicitly by evaluators. */
export const HEALTH_RANK: Record<HealthStatus, number> = { green: 0, grey: 1, amber: 2, red: 3 };

export const SeveritySchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
  'informational',
  'unknown',
]);
export type Severity = z.infer<typeof SeveritySchema>;
export const SEVERITIES: readonly Severity[] = SeveritySchema.options;

export const FindingStatusSchema = z.enum([
  'open',
  'fixed',
  'dismissed',
  'accepted-risk',
  'false-positive',
  'unknown',
]);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const FindingCategorySchema = z.enum([
  'code',
  'dependency',
  'secret',
  'container',
  'iac',
  'dast',
  'supply-chain',
  'configuration',
]);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

export const FindingSourceSchema = z.enum([
  'github-code-scanning',
  'github-dependabot',
  'github-secret-scanning',
  'security-status-file',
]);
export type FindingSource = z.infer<typeof FindingSourceSchema>;

export const ControlIdSchema = z.enum([
  'codeScanning',
  'secretScanning',
  'dependabot',
  'containerScanning',
  'iacScanning',
  'dast',
  'sbom',
  'artifactSignature',
]);
export type ControlId = z.infer<typeof ControlIdSchema>;
export const CONTROL_IDS: readonly ControlId[] = ControlIdSchema.options;
export const NATIVE_CONTROLS: readonly ControlId[] = [
  'codeScanning',
  'secretScanning',
  'dependabot',
];

/**
 * State of a security control for one repository. Keeps apart the cases that a naive
 * dashboard would all render as "0 alerts".
 */
export const ControlStateSchema = z.enum([
  'enabled', // data collected, control active and recent
  'not-configured', // control explicitly not set up / not integrated
  'configured-not-run', // configured but no completed scan yet
  'not-authorised', // credentials lack the permission to read it
  'failed', // the scan itself reported a failure
  'stale', // last result older than the policy threshold
  'unknown', // cannot be determined (ambiguous 404, invalid data, ...)
  'collection-failed', // collector error (network, rate limit, 5xx)
  'not-applicable', // excluded for this component in the catalog
]);
export type ControlState = z.infer<typeof ControlStateSchema>;

export const ErrorClassificationSchema = z.enum([
  'not-found',
  'not-authorised',
  'not-configured',
  'rate-limited',
  'invalid-data',
  'error',
]);
export type ErrorClassification = z.infer<typeof ErrorClassificationSchema>;

export const AvailabilitySchema = z.enum([
  'available',
  'partial',
  'not-authorised',
  'unknown',
  'not-used',
]);
export type Availability = z.infer<typeof AvailabilitySchema>;

export const LifecycleSchema = z.enum([
  'experimental',
  'development',
  'production',
  'maintenance',
  'deprecated',
]);
export type Lifecycle = z.infer<typeof LifecycleSchema>;

export const ComponentTypeSchema = z.enum([
  'service',
  'webapp',
  'worker',
  'deployment',
  'infrastructure',
  'library',
  'other',
]);
export type ComponentType = z.infer<typeof ComponentTypeSchema>;

export const DataSourceSchema = z.enum(['mock', 'github']);
export type DataSource = z.infer<typeof DataSourceSchema>;

export const AuthenticationModeSchema = z.enum([
  'github-app',
  'fine-grained-token',
  'github-token',
  'mock',
]);
export type AuthenticationMode = z.infer<typeof AuthenticationModeSchema>;

export const CapabilitySchema = z.enum([
  'metadata',
  'contents',
  'actions',
  'codeScanning',
  'dependabot',
  'secretScanning',
]);
export type Capability = z.infer<typeof CapabilitySchema>;

export const DimensionSchema = z.enum([
  'delivery',
  'version',
  'security',
  'coverage',
  'governance',
]);
export type Dimension = z.infer<typeof DimensionSchema>;

/**
 * Every reason a health evaluator can emit. Kept as a closed list so the UI can
 * translate each one (EN/IT key parity is tested).
 */
export const REASON_CODES = [
  // delivery
  'workflow-failed',
  'workflow-cancelled',
  'critical-workflow-missing',
  'critical-workflow-never-run',
  'workflow-queued-too-long',
  'workflow-stale',
  'workflow-data-unavailable',
  'non-critical-workflow-failed',
  'no-critical-workflows',
  'critical-workflows-succeeded',
  // version
  'manifest-unknown-component',
  'submodule-unresolvable',
  'submodule-unmapped',
  'component-version-drift',
  'submodule-untagged',
  'manifest-submodule-mismatch',
  'component-version-unknown',
  'environment-behind',
  'environment-mismatch',
  'environment-version-unknown',
  'coordinator-version-unknown',
  'manifest-missing',
  'manifest-invalid',
  'versions-aligned',
  // security
  'open-critical-alerts',
  'open-high-alerts',
  'open-medium-low-alerts',
  'open-secret-alerts',
  'required-control-failed',
  'required-control-stale',
  'coverage-incomplete',
  'security-data-unavailable',
  'private-details-withheld',
  'no-open-alerts',
  // coverage
  'required-control-not-configured',
  'required-control-not-authorised',
  'required-control-unknown',
  'no-required-controls',
  'all-required-controls-available',
  // governance
  'standard-workflow-missing',
  'repository-archived',
  'security-status-file-missing',
  'security-status-file-invalid',
  'default-branch-mismatch',
  'repository-unavailable',
  'governance-compliant',
  // freshness / overall
  'source-stale',
  'data-fresh',
  'no-data',
  'dimension-red',
  'dimension-amber',
  'dimension-grey',
  'all-dimensions-green',
] as const;
export const ReasonCodeSchema = z.enum(REASON_CODES);
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

export const ReasonLevelSchema = z.enum(['red', 'amber', 'grey', 'info']);
export type ReasonLevel = z.infer<typeof ReasonLevelSchema>;

export const ReasonSchema = z
  .object({
    code: ReasonCodeSchema,
    level: ReasonLevelSchema,
    params: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  })
  .strict();
export type Reason = z.infer<typeof ReasonSchema>;

export const HealthResultSchema = z
  .object({
    status: HealthStatusSchema,
    reasons: z.array(ReasonSchema),
  })
  .strict();
export type HealthResult = z.infer<typeof HealthResultSchema>;
