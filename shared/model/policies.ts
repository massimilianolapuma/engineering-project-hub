import { z } from 'zod';
import { DimensionSchema, REPOSITORY_CHECK_IDS, SeveritySchema } from './enums';

const NonGreenStatus = z.enum(['red', 'amber', 'grey']);
const RedOrAmber = z.enum(['red', 'amber']);
/** info = shown, never changes Governance. */
const CheckLevel = z.enum(['info', 'amber', 'red']);

/**
 * Health policies. These are MVP policies for this organisation, not universal risk
 * assessments: tune them in config/policies.yaml without touching code or frontend.
 */
export const PoliciesSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    freshness: z
      .object({
        snapshotStaleHours: z.number().positive().default(24),
        workflowRunStaleDays: z.number().positive().default(14),
        securityScanStaleDays: z.number().positive().default(7),
        securityStatusFileStaleDays: z.number().positive().default(7),
        /** generatedAt of a hub-quality-summary older than this = stale (still counted). */
        qualityReportStaleDays: z.number().positive().default(14),
      })
      .strict(),
    delivery: z
      .object({
        queuedThresholdMinutes: z.number().positive().default(60),
        missingCriticalWorkflow: NonGreenStatus.default('amber'),
        failedCriticalWorkflow: RedOrAmber.default('red'),
      })
      .strict(),
    security: z
      .object({
        /** Open findings at these severities make Security Risk red. */
        redOnSeverities: z.array(SeveritySchema).default(['critical']),
        /** Open findings at these severities make Security Risk amber. */
        amberOnSeverities: z.array(SeveritySchema).default(['high', 'medium', 'low']),
        openSecretAlertIsRed: z.boolean().default(true),
        requiredControlFailedIsRed: z.boolean().default(true),
        staleScanIsAmber: z.boolean().default(true),
        incompleteCoverageIsAmber: z.boolean().default(true),
      })
      .strict(),
    coverage: z
      .object({
        greenThresholdPercent: z.number().min(0).max(100).default(100),
      })
      .strict(),
    /** Quality: line coverage from the CI hub-quality-summary artifact. Optional block. */
    quality: z
      .object({
        greenThresholdPercent: z.number().min(0).max(100).default(80),
        /** Below this percentage the status is red. */
        amberThresholdPercent: z.number().min(0).max(100).default(60),
        /** Some applicable components without a visible report → at most amber. */
        missingReportIsAmber: z.boolean().default(true),
      })
      .strict()
      .refine((q) => q.amberThresholdPercent <= q.greenThresholdPercent, {
        message: 'amberThresholdPercent must not exceed greenThresholdPercent',
      })
      .prefault({}),
    version: z
      .object({
        componentDrift: RedOrAmber.default('amber'),
        environmentBehind: RedOrAmber.default('amber'),
        unresolvableSubmodule: RedOrAmber.default('red'),
        unknownManifestComponent: RedOrAmber.default('red'),
        unmappedSubmodule: NonGreenStatus.default('amber'),
        /** The coordinator pins a SHA that is not a release tag of the component. */
        untaggedSubmodule: NonGreenStatus.default('amber'),
        /** The manifest declares a version different from the one the submodule pins. */
        manifestSubmoduleMismatch: RedOrAmber.default('amber'),
      })
      .strict(),
    governance: z
      .object({
        missingStandardWorkflow: NonGreenStatus.default('amber'),
        archivedRepository: NonGreenStatus.default('amber'),
        missingSecurityStatusFile: NonGreenStatus.default('amber'),
        defaultBranchMismatch: NonGreenStatus.default('amber'),
      })
      .strict(),
    /**
     * Repository controls (workflow files and branch rules). Every check is informative by
     * default: nothing changes Governance until the owner enforces it. Optional block.
     */
    repositoryControls: z
      .object({
        enabled: z.boolean().default(true),
        checks: z
          .object(
            Object.fromEntries(
              REPOSITORY_CHECK_IDS.map((id) => [id, CheckLevel.default('info')]),
            ) as Record<(typeof REPOSITORY_CHECK_IDS)[number], z.ZodDefault<typeof CheckLevel>>,
          )
          .strict()
          .prefault({}),
        /** What an enforced check that cannot be determined does to Governance. */
        unknownEnforcedCheck: z.enum(['info', 'amber']).default('info'),
        /** Owners whose unpinned actions count as pinned (e.g. "actions", "github"). */
        exemptActionOwners: z
          .array(z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, 'must be a GitHub owner'))
          .default([]),
        maxWorkflowFiles: z.number().int().min(1).max(100).default(30),
        /** true needs "Administration: read" on the credentials. */
        readClassicProtection: z.boolean().default(false),
      })
      .strict()
      .prefault({}),
    overall: z
      .object({
        /** A red in one of these makes the project red. A red elsewhere counts as amber. */
        criticalDimensions: z.array(DimensionSchema).default(['delivery', 'version', 'security']),
        /** All of these must be green for the project to be green. */
        requiredDimensions: z
          .array(DimensionSchema)
          .default(['delivery', 'version', 'security', 'coverage', 'governance']),
        /**
         * Counted like a required non-critical dimension when measured; ignored when grey (it
         * neither turns the project grey nor lowers the score's measured ratio).
         */
        optionalDimensions: z.array(DimensionSchema).default(['quality']),
        /** What an undeterminable required dimension does to the overall status. */
        greyRequiredDimension: z.enum(['grey', 'amber']).default('grey'),
      })
      .strict()
      .refine((o) => !o.requiredDimensions.some((d) => o.optionalDimensions.includes(d)), {
        message: 'a dimension cannot be in both requiredDimensions and optionalDimensions',
        path: ['optionalDimensions'],
      }),
    /**
     * Project score (0–100) used to rank and compare projects. Optional: omitted, the
     * defaults below apply. Grey dimensions are never counted as 0 (see docs/configuration.md).
     */
    score: z
      .object({
        /** Relative weight of each dimension in the weighted mean. */
        weights: z
          .object({
            delivery: z.number().min(0).default(25),
            version: z.number().min(0).default(15),
            security: z.number().min(0).default(30),
            coverage: z.number().min(0).default(15),
            governance: z.number().min(0).default(15),
            quality: z.number().min(0).default(10),
          })
          .strict()
          .prefault({}),
        /** Points of a measured dimension by status. Grey is not measured. */
        points: z
          .object({
            green: z.number().min(0).max(100).default(100),
            amber: z.number().min(0).max(100).default(60),
            red: z.number().min(0).max(100).default(20),
          })
          .strict()
          .prefault({}),
        /** Upper bound of the score by overall status, so the number agrees with the status. */
        caps: z
          .object({
            red: z.number().int().min(0).max(100).default(49),
            amber: z.number().int().min(0).max(100).default(89),
            grey: z.number().int().min(0).max(100).default(89),
          })
          .strict()
          .prefault({}),
        /** Below this share of measured required dimensions the score is null (insufficient data). */
        minMeasuredRatio: z.number().min(0).max(1).default(0.5),
      })
      .strict()
      .prefault({}),
    /** Compact history kept between runs (history.json) and the "what changed" diff. */
    history: z
      .object({
        enabled: z.boolean().default(true),
        /** 120 = 30 days at the 6-hour schedule. */
        maxEntries: z.number().int().min(2).max(1000).default(120),
        maxAgeDays: z.number().int().min(1).max(400).default(90),
      })
      .strict()
      .prefault({}),
    publication: z
      .object({
        /**
         * "public": the site may be world-readable. Titles / rule ids of findings in
         * private or internal repositories are withheld (counts and links are kept).
         * "restricted": the site is served behind access control (e.g. private Pages).
         */
        audience: z.enum(['public', 'restricted']).default('public'),
        /** Only links to these hosts are published. Everything else is dropped. */
        allowedLinkHosts: z
          .array(z.string().regex(/^[a-z0-9.-]+$/))
          .min(1)
          .default(['github.com']),
      })
      .strict(),
  })
  .strict();
export type Policies = z.infer<typeof PoliciesSchema>;
