import { z } from 'zod';
import { DimensionSchema, SeveritySchema } from './enums';

const NonGreenStatus = z.enum(['red', 'amber', 'grey']);
const RedOrAmber = z.enum(['red', 'amber']);

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
    overall: z
      .object({
        /** A red in one of these makes the project red. A red elsewhere counts as amber. */
        criticalDimensions: z.array(DimensionSchema).default(['delivery', 'version', 'security']),
        /** All of these must be green for the project to be green. */
        requiredDimensions: z
          .array(DimensionSchema)
          .default(['delivery', 'version', 'security', 'coverage', 'governance']),
        /** What an undeterminable required dimension does to the overall status. */
        greyRequiredDimension: z.enum(['grey', 'amber']).default('grey'),
      })
      .strict(),
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
