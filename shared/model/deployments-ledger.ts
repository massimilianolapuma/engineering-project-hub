import { z } from 'zod';
import { httpsUrl, isoDate } from './primitives';

/*
 * Deployments ledger (spec 2026-11-04-deployments-ledger, ADR 0015): GitHub Deployments record
 * every deploy of every environment. External writers (push step, pull bridge, declared record)
 * follow this contract; the hub reads it through the `github-deployments` deploy signal.
 */

export const LEDGER_SOURCES = ['azure-devops', 'manual', 'other'] as const;
export const LedgerSourceSchema = z.enum(LEDGER_SOURCES);
export type LedgerSource = z.infer<typeof LedgerSourceSchema>;

/** `payload` of a ledger deployment. Times are the real deploy times (D10), never write times. */
export const LedgerPayloadSchema = z
  .object({
    ledger: z.literal(1),
    source: LedgerSourceSchema,
    runId: z.string().min(1).max(100),
    runUrl: httpsUrl,
    attempt: z.number().int().min(1).default(1),
    version: z.string().min(1).max(100).optional(),
    startedAt: isoDate.optional(),
    finishedAt: isoDate.optional(),
    declared: z.boolean().default(false),
    kind: z.enum(['deploy', 'rollback']).default('deploy'),
  })
  .strict();
export type LedgerPayload = z.infer<typeof LedgerPayloadSchema>;

const repository = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'must be owner/repo');
const sha = z.string().regex(/^[0-9a-f]{40}$/);

/** One deploy to write: a deployment on `sha` plus its final status. */
export const LedgerRecordSchema = z
  .object({
    repository,
    environment: z.string().min(1).max(255),
    sha,
    production: z.boolean(),
    state: z.enum(['success', 'failure']),
    description: z.string().max(140),
    payload: LedgerPayloadSchema.refine((p) => p.finishedAt !== undefined, {
      message: 'finishedAt is required: the real time of the deploy',
      path: ['finishedAt'],
    }),
  })
  .strict();
export type LedgerRecord = z.infer<typeof LedgerRecordSchema>;

/** Idempotency key (D4): the same external record written twice is one deploy. */
export function ledgerKey(r: {
  environment: string;
  payload: Pick<LedgerPayload, 'source' | 'runId' | 'attempt'>;
}): string {
  return `${r.payload.source}:${r.payload.runId}:${r.payload.attempt}:${r.environment}`;
}

const relativePath = z
  .string()
  .min(1)
  .max(255)
  .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), 'must be a relative path');

/** Bridge map (spec §5.3): which ADO environments are transcribed into which repositories. */
export const DeploymentsBridgeMapSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    sources: z
      .array(
        z
          .object({
            type: z.literal('azure-devops'),
            organization: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/),
            project: z.string().min(1).max(64),
            environments: z
              .array(
                z
                  .object({
                    ado: z.string().min(1).max(64),
                    repository,
                    github: z.string().min(1).max(255),
                    production: z.boolean().default(false),
                    versionFrom: z
                      .object({
                        file: relativePath,
                        key: z
                          .string()
                          .regex(/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/)
                          .max(100),
                      })
                      .strict()
                      .optional(),
                    commitFrom: z.string().min(1).max(100).default('self'),
                  })
                  .strict(),
              )
              .min(1)
              .max(50),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type DeploymentsBridgeMap = z.infer<typeof DeploymentsBridgeMapSchema>;

/**
 * Declared-deploy allowlist (security review of the declare workflow): the repositories and
 * environments a person may declare deploys for, kept in the calling repository and reviewed in
 * pull requests. Anything not listed is refused before a writer token is requested.
 */
export const DeclareAllowlistSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    targets: z
      .array(
        z
          .object({
            repository,
            environments: z.array(z.string().min(1).max(255)).min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
export type DeclareAllowlist = z.infer<typeof DeclareAllowlistSchema>;
