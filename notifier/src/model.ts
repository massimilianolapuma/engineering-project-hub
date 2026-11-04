import { z } from 'zod';
import { DimensionSchema, HealthStatusSchema } from '@model/index';

/*
 * The digest (spec §5.5.3): the only data a notification is rendered from. Project ids and names,
 * statuses, scores and counts; a link host is added later from siteUrl only.
 */
const count = z.number().int().min(0);
const utcDate = z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
const score = z.number().int().min(0).max(100).nullable();

export const DigestProjectSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    name: z.string().max(100),
    overall: z.object({ from: HealthStatusSchema.nullable(), to: HealthStatusSchema }).strict(),
    score: z.object({ from: score, to: score }).strict(),
    dimensions: z.array(
      z
        .object({ dimension: DimensionSchema, from: HealthStatusSchema, to: HealthStatusSchema })
        .strict(),
    ),
    newFindings: z.object({ critical: count, high: count }).strict(),
    newlyOverdue: z.object({ critical: count, high: count }).strict(),
    newErrors: count,
    expiredExceptions: count,
  })
  .strict();
export type DigestProject = z.infer<typeof DigestProjectSchema>;

export const DigestSchema = z
  .object({
    key: z.string().regex(/^[0-9a-f]{16}$/),
    generatedAt: utcDate,
    previousCollectedAt: utcDate,
    locale: z.enum(['en', 'it']),
    siteUrl: z.string().max(200).nullable(),
    totals: z
      .object({
        projects: count,
        overallWorsened: count,
        becameUnknown: count,
        newCritical: count,
        newHigh: count,
        newlyOverdue: count,
        newErrors: count,
        expiredExceptions: count,
      })
      .strict(),
    projects: z.array(DigestProjectSchema).max(50),
    omittedProjects: count,
  })
  .strict();
export type Digest = z.infer<typeof DigestSchema>;
