import { z } from 'zod';
import { EcosystemSchema } from './enums';

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

/**
 * Summary published by the repository's CI as the `hub-quality-summary` artifact
 * (file `quality-summary.json`). Counts only: no paths, no raw reports.
 */
export const QualitySummarySchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    repository: z.string().min(1).max(200),
    ref: z.string().min(1).max(200),
    commitSha: z.string().regex(/^[0-9a-f]{40}$/),
    generatedAt: z.iso.datetime({ offset: true }),
    tool: z.string().min(1).max(40),
    format: z.enum(['cobertura', 'lcov', 'opencover', 'jacoco', 'other']),
    lines: z
      .object({
        covered: z.number().int().min(0),
        valid: z.number().int().min(0),
      })
      .strict()
      .refine((l) => l.covered <= l.valid, { message: 'covered must not exceed valid' }),
  })
  .strict();
export type QualitySummary = z.infer<typeof QualitySummarySchema>;

/** SPDX licence expression operators; everything else in an expression is an identifier. */
const LICENSE_OPERATORS = new Set(['AND', 'OR', 'WITH']);
const LICENSE_TOKEN = /^[A-Za-z0-9.+-]{1,64}$/;

/**
 * Publishable form of an SPDX license expression, or null when it must not be published:
 * empty, NOASSERTION / NONE, longer than 100 characters, or with a token that is not a plain
 * identifier. Any LicenseRef-* token folds the whole expression into "LicenseRef-*": custom
 * licence names can be internal. Only identifiers ever reach the output, never licence texts.
 */
export function spdxLicenseExpression(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text || text.length > 100) return null;
  const tokens = text.split(/[\s()]+/).filter(Boolean);
  const ids = tokens.filter((t) => !LICENSE_OPERATORS.has(t));
  if (!ids.length) return null;
  if (!ids.every((t) => LICENSE_TOKEN.test(t))) return null;
  if (ids.some((t) => /^(?:NOASSERTION|NONE)$/i.test(t))) return null;
  if (ids.some((t) => /^LicenseRef-/i.test(t))) return 'LicenseRef-*';
  return text.replace(/\s+/g, ' ');
}

/** OCI repository path without a registry host (lowercase segments, `.` `_` `-` separators). */
export const OCI_REPOSITORY_RE =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;

/**
 * Same rule Docker uses to recognise a registry host: with several segments, a first segment
 * holding `.` or `:`, or equal to "localhost", is a host and not a repository namespace.
 */
export function isOciRepository(name: string): boolean {
  if (name.length > 200 || !OCI_REPOSITORY_RE.test(name)) return false;
  const segments = name.split('/');
  if (segments.length < 2) return true;
  const first = segments[0]!;
  return !first.includes('.') && !first.includes(':') && first !== 'localhost';
}

export const ociRepository = z
  .string()
  .max(200)
  .refine(isOciRepository, 'must be an OCI repository path without a registry host');

const SummaryCount = z.number().int().min(0);
const publishableLicense = z.string().transform((value, ctx) => {
  const id = spdxLicenseExpression(value);
  if (id === null) {
    ctx.addIssue({ code: 'custom', message: 'not a publishable SPDX license expression' });
    return z.NEVER;
  }
  return id;
});

const VerificationStatusSchema = z.enum(['verified', 'not-verified', 'failed', 'missing']);
const VerificationSchema = z
  .object({
    status: VerificationStatusSchema,
    tool: z.enum(['cosign', 'notation', 'gh-attestation', 'other']).optional(),
  })
  .strict();

/**
 * Summary published by the repository's CI as the `hub-supply-chain-summary` artifact (file
 * `supply-chain-summary.json`). Counts and verification results only: no package names, keys,
 * certificates, identities or Rekor entries.
 */
export const SupplyChainSummarySchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    repository: z.string().min(1).max(200),
    ref: z.string().min(1).max(200),
    commitSha: z.string().regex(/^[0-9a-f]{40}$/),
    generatedAt: z.iso.datetime({ offset: true }),
    sbom: z
      .object({
        format: z.enum(['cyclonedx', 'spdx']),
        specVersion: z.string().regex(/^\d+\.\d+(?:\.\d+)?$/),
        tool: z.string().min(1).max(40),
        packages: SummaryCount,
        withoutLicense: SummaryCount,
        licenses: z
          .array(z.object({ id: publishableLicense, count: SummaryCount }).strict())
          .max(20),
        ecosystems: z
          .array(z.object({ id: EcosystemSchema, count: SummaryCount }).strict())
          .max(20),
      })
      .strict()
      .refine((s) => s.withoutLicense <= s.packages, {
        message: 'withoutLicense must not exceed packages',
        path: ['withoutLicense'],
      })
      .optional(),
    images: z
      .array(
        z
          .object({
            name: ociRepository,
            tag: z
              .string()
              .regex(/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/)
              .optional(),
            digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
            signature: VerificationSchema.optional(),
            provenance: VerificationSchema.optional(),
            sbomAttestation: VerificationSchema.optional(),
          })
          .strict(),
      )
      .max(10)
      .optional(),
  })
  .strict();
export type SupplyChainSummary = z.infer<typeof SupplyChainSummarySchema>;
