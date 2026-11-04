import { z } from 'zod';
import { LEDGER_SOURCES } from './ledger';

/*
 * Control map (spec 2026-11-04, ADR 0014): technical checks the hub can evidence, each with a
 * 0–5 level and the related DORA (Regulation (EU) 2022/2554, RTS 2024/1774) and ISO/IEC
 * 27001:2022 Annex A references. The references are data shown as "related": the hub never claims
 * compliance with either.
 */

export const CONTROL_AREAS = [
  'supply-chain',
  'vulnerabilities',
  'secrets',
  'change-access',
  'delivery',
  'evidence',
] as const;
export const ControlAreaSchema = z.enum(CONTROL_AREAS);
export type ControlArea = z.infer<typeof ControlAreaSchema>;

export const CHECK_IDS = [
  'sbom-coverage',
  'image-signature',
  'build-provenance',
  'license-policy',
  'dependency-scanning',
  'sast',
  'container-scanning',
  'iac-scanning',
  'dast',
  'vulnerability-age',
  'security-mttr',
  'secret-scanning',
  'exposed-secrets',
  'workload-identity',
  'branch-protection',
  'required-checks',
  'pipeline-integrity',
  'environment-separation',
  'config-drift',
  'deploy-frequency',
  'lead-time',
  'change-failure-rate',
  'time-to-restore',
  'test-coverage',
  'evidence-freshness',
] as const;
export const CheckIdSchema = z.enum(CHECK_IDS);
export type CheckId = z.infer<typeof CheckIdSchema>;

export interface CheckDef {
  id: CheckId;
  area: ControlArea;
  /** DORA Regulation articles ("art. N") and RTS 2024/1774 articles ("RTS art. N"). */
  dora: readonly string[];
  /** ISO/IEC 27001:2022 Annex A controls ("5.9") or clauses ("cl. 9.1"). */
  iso: readonly string[];
}

const def = (id: CheckId, area: ControlArea, dora: string[], iso: string[]): CheckDef => ({
  id,
  area,
  dora,
  iso,
});

/** The checks of spec §5.2, in table order (heatmap column order). */
export const CONTROL_CHECKS: readonly CheckDef[] = [
  def('sbom-coverage', 'supply-chain', ['art. 8', 'RTS art. 4–5', 'RTS art. 16'], ['5.9', '5.21']),
  def('image-signature', 'supply-chain', ['RTS art. 16'], ['5.21', '8.24']),
  def('build-provenance', 'supply-chain', ['RTS art. 16'], ['5.21', '8.25']),
  def('license-policy', 'supply-chain', ['RTS art. 16'], ['5.32']),
  def('dependency-scanning', 'supply-chain', ['RTS art. 10'], ['8.8']),
  def('sast', 'vulnerabilities', ['art. 25', 'RTS art. 10', 'RTS art. 16'], ['8.28', '8.29']),
  def('container-scanning', 'vulnerabilities', ['art. 25', 'RTS art. 10'], ['8.8']),
  def('iac-scanning', 'vulnerabilities', ['RTS art. 10', 'RTS art. 16'], ['8.9']),
  def('dast', 'vulnerabilities', ['art. 25'], ['8.29']),
  def('vulnerability-age', 'vulnerabilities', ['RTS art. 10'], ['8.8']),
  def('security-mttr', 'vulnerabilities', ['art. 10–11', 'RTS art. 10'], ['8.8', '5.26']),
  def('secret-scanning', 'secrets', ['RTS art. 7', 'RTS art. 11'], ['5.17', '8.24']),
  def('exposed-secrets', 'secrets', ['RTS art. 7'], ['5.17']),
  def('workload-identity', 'secrets', ['RTS art. 7', 'RTS art. 20–21'], ['5.17', '8.5']),
  def('branch-protection', 'change-access', ['RTS art. 17', 'RTS art. 21'], ['8.4', '8.32']),
  def('required-checks', 'change-access', ['RTS art. 17'], ['8.29', '8.32']),
  def('pipeline-integrity', 'change-access', ['RTS art. 16'], ['5.21', '8.25']),
  def('environment-separation', 'change-access', ['RTS art. 17'], ['8.31']),
  def('config-drift', 'change-access', ['RTS art. 17'], ['8.9']),
  def('deploy-frequency', 'delivery', ['RTS art. 17'], ['8.32']),
  def('lead-time', 'delivery', ['RTS art. 17'], ['8.32']),
  def('change-failure-rate', 'delivery', ['art. 11', 'RTS art. 17'], ['8.32']),
  def('time-to-restore', 'delivery', ['art. 11–12', 'RTS art. 26'], ['5.30']),
  def('test-coverage', 'delivery', ['RTS art. 16'], ['8.29']),
  def('evidence-freshness', 'evidence', ['art. 13'], ['5.36', 'cl. 9.1']),
];

export const LEVELS = [0, 1, 2, 3, 4, 5] as const;
export type Level = (typeof LEVELS)[number];
const LevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const ControlReasonSchema = z.enum([
  'source-unreadable',
  'too-few-readable',
  'external-pipelines',
  'no-deploy-signal',
  'no-object',
  'catalog-not-applicable',
  'needs-permission',
  'no-argocd',
  'insufficient-events',
]);
export type ControlReason = z.infer<typeof ControlReasonSchema>;

export const DeploySignalTypeSchema = z.enum([
  'workflow',
  'versions-file',
  'argocd',
  'release',
  'github-deployments',
  'external',
]);

const count = z.number().int().min(0);

export const ControlCellSchema = z
  .object({
    check: CheckIdSchema,
    level: LevelSchema.nullable(),
    state: z.enum(['measured', 'not-visible', 'not-applicable']),
    value: z.number().nullable(),
    unit: z.enum(['percent', 'count', 'per-week', 'hours', 'days', 'level']),
    /** The lower bound of the level reached (the threshold that set it), when the ladder has one. */
    threshold: z.number().nullable(),
    readable: z.object({ k: count, n: count }).strict().nullable(),
    reason: ControlReasonSchema.nullable(),
    note: z.string().max(200).nullable(),
    environment: z.string().max(50).nullable(),
    signal: DeploySignalTypeSchema.nullable(),
  })
  .strict();
export type ControlCell = z.infer<typeof ControlCellSchema>;

const scoreBlock = z
  .object({
    score: z.number().int().min(0).max(100).nullable(),
    measured: count,
    applicable: count,
  })
  .strict();

export const ControlMapSchema = z
  .object({
    cells: z.array(ControlCellSchema).length(CHECK_IDS.length),
    score: z.number().int().min(0).max(100).nullable(),
    measured: count,
    applicable: count,
    areas: z.object(
      Object.fromEntries(CONTROL_AREAS.map((a) => [a, scoreBlock])) as Record<
        ControlArea,
        typeof scoreBlock
      >,
    ),
  })
  .strict();
export type ControlMap = z.infer<typeof ControlMapSchema>;

export const ControlMapSummarySchema = z
  .object({
    score: z.number().int().min(0).max(100).nullable(),
    measured: count,
    applicable: count,
    levels: z.object(
      Object.fromEntries(
        CHECK_IDS.map((id) => [id, z.union([LevelSchema, z.literal('n/a')]).nullable()]),
      ) as Record<CheckId, z.ZodNullable<z.ZodUnion<[typeof LevelSchema, z.ZodLiteral<'n/a'>]>>>,
    ),
  })
  .strict();
export type ControlMapSummary = z.infer<typeof ControlMapSummarySchema>;

/** Catalog: how deploys of an environment are observed (spec §5.3). Default: external. */
export const DeploySignalSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('workflow'), workflow: z.string().regex(/^[a-z0-9][a-z0-9-]*$/) })
    .strict(),
  z
    .object({
      type: z.literal('versions-file'),
      repository: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      path: z
        .string()
        .min(1)
        .max(255)
        .refine(
          (p) => !p.startsWith('/') && !p.split('/').includes('..'),
          'must be a relative path',
        ),
      key: z
        .string()
        .regex(/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/)
        .max(100),
      tagPrefix: z.string().max(50).default('v'),
    })
    .strict(),
  z.object({ type: z.literal('argocd') }).strict(),
  z.object({ type: z.literal('release') }).strict(),
  // Deployments ledger (ADR 0015): GitHub Deployments of the repository, written by Actions jobs
  // and by external writers (push step, pull bridge, declared record).
  z
    .object({
      type: z.literal('github-deployments'),
      repository: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      environment: z.string().min(1).max(255).optional(),
      tagPrefix: z.string().max(50).default('v'),
      sources: z
        .array(z.enum(['github-actions', ...LEDGER_SOURCES]))
        .min(1)
        .max(4)
        .optional(),
    })
    .strict(),
  z.object({ type: z.literal('external') }).strict(),
]);
export type DeploySignal = z.infer<typeof DeploySignalSchema>;

export const ProjectControlMapConfigSchema = z
  .object({
    notApplicable: z
      .array(z.object({ check: CheckIdSchema, reason: z.string().trim().min(1).max(200) }).strict())
      .max(CHECK_IDS.length)
      .default([]),
  })
  .strict();

/** policies.yaml `controlMap` block. */
export const ControlMapPolicySchema = z
  .object({
    enabled: z.boolean().default(true),
    windows: z
      .object({
        frequencyDays: z.number().int().min(1).max(90).default(30),
        trendDays: z.number().int().min(7).max(365).default(90),
      })
      .strict()
      .prefault({}),
    /** Per-check override of the ladder: the values for levels 1–5. */
    thresholds: z.partialRecord(CheckIdSchema, z.array(z.number()).length(5)).default({}),
  })
  .strict();
