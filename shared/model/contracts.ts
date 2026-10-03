import { z } from 'zod';

/**
 * Contract read from `.security/project-security-status.json` in each repository.
 * Produced by pipelines for controls GitHub does not provide natively
 * (container / IaC scanning, DAST, SBOM, artifact signature).
 */
const count = z.number().int().min(0);

const ScanControlSchema = z
  .object({
    status: z.enum(['completed', 'failed', 'not-configured', 'not-run', 'running']),
    tool: z.string().max(50).optional(),
    critical: count.optional(),
    high: count.optional(),
    medium: count.optional(),
    low: count.optional(),
    completedAt: z.iso.datetime({ offset: true }).optional(),
    reportUrl: z.string().max(500).optional(),
  })
  .strict();

const SbomControlSchema = z
  .object({
    status: z.enum(['available', 'failed', 'not-configured', 'not-run']),
    format: z.enum(['cyclonedx', 'spdx']).optional(),
    reportUrl: z.string().max(500).optional(),
  })
  .strict();

const SignatureControlSchema = z
  .object({
    status: z.enum(['verified', 'not-verified', 'failed', 'not-configured', 'not-run']),
    tool: z.string().max(50).optional(),
  })
  .strict();

export const SecurityStatusFileSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    generatedAt: z.iso.datetime({ offset: true }),
    repository: z.string().max(200),
    version: z.string().max(100).optional(),
    commitSha: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .optional(),
    controls: z
      .object({
        containerScanning: ScanControlSchema.optional(),
        iacScanning: ScanControlSchema.optional(),
        dast: ScanControlSchema.optional(),
        sbom: SbomControlSchema.optional(),
        artifactSignature: SignatureControlSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type SecurityStatusFile = z.infer<typeof SecurityStatusFileSchema>;
export type ScanControl = z.infer<typeof ScanControlSchema>;

/**
 * Contract read from the coordinator repository (default `release-manifest.yaml`).
 * Declares the coordinator version, the component versions it expects and, optionally,
 * what each environment is believed to run. Environment data is declarative: the real
 * runtime version needs future integrations (e.g. Argo CD).
 */
export const ReleaseManifestSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    version: z.string().min(1).max(100),
    components: z
      .record(z.string(), z.object({ version: z.string().min(1).max(100) }).strict())
      .default({}),
    environments: z
      .record(z.string(), z.object({ version: z.string().min(1).max(100) }).strict())
      .default({}),
  })
  .strict();
export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;
