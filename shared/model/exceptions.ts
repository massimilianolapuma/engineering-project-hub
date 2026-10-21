import { z } from 'zod';
import { DimensionSchema, HealthStatusSchema, SeveritySchema } from './enums';

/*
 * Security exceptions (config/exceptions.yaml) and policy decision cases. The file is reviewed
 * configuration: every object is strict and every field is bounded.
 */

export function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export const ExceptionSourceSchema = z.enum(['code-scanning', 'dependabot', 'secret-scanning']);
export type ExceptionSource = z.infer<typeof ExceptionSourceSchema>;

export const ExceptionDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, 'must be a real date (YYYY-MM-DD)');

export const ExceptionMatchSchema = z.union([
  z.object({ alert: z.number().int().min(1) }).strict(),
  z
    .object({ rule: z.string().min(1).max(200), tool: z.string().min(1).max(50).optional() })
    .strict(),
  z
    .object({
      // Case-insensitive written out (not /i), so the generated JSON Schema accepts the same ids.
      advisory: z
        .string()
        .max(100)
        .regex(/^([Gg][Hh][Ss][Aa](-[A-Za-z0-9]{4}){3}|[Cc][Vv][Ee]-\d{4}-\d{4,7})$/),
    })
    .strict(),
]);
export type ExceptionMatch = z.infer<typeof ExceptionMatchSchema>;

const exceptionFields = {
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$/),
  repository: z
    .string()
    .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/)
    .max(200),
  source: ExceptionSourceSchema,
  match: ExceptionMatchSchema,
  owner: z.string().regex(/^@?[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/),
  reason: z.string().trim().min(10).max(300),
  ticket: z
    .url({ protocol: /^https$/ })
    .max(500)
    .optional(),
};

type SelectorShape = { source: ExceptionSource; match: ExceptionMatch };
/** Selector kinds allowed per source (secret scanning accepts alert numbers only). */
function withSelectorChecks<T extends z.ZodType<SelectorShape>>(schema: T) {
  return schema
    .refine((e) => !('rule' in e.match) || e.source === 'code-scanning', {
      message: 'rule selectors are only valid for code-scanning',
      path: ['match'],
    })
    .refine((e) => !('advisory' in e.match) || e.source === 'dependabot', {
      message: 'advisory selectors are only valid for dependabot',
      path: ['match'],
    });
}

export const ExceptionEntrySchema = withSelectorChecks(
  z
    .object({ ...exceptionFields, created: ExceptionDateSchema, expires: ExceptionDateSchema })
    .strict(),
).refine((e) => e.expires >= e.created, {
  message: 'expires must not be before created',
  path: ['expires'],
});
export type ExceptionEntry = z.infer<typeof ExceptionEntrySchema>;

/** Stable identity of an exception's scope: repository, source and selector. */
export function selectorKey(e: Pick<ExceptionEntry, 'repository' | 'source' | 'match'>): string {
  const head = `${e.repository.toLowerCase()}|${e.source}`;
  if ('alert' in e.match) return `${head}|alert:${e.match.alert}`;
  if ('rule' in e.match)
    return `${head}|rule:${e.match.rule}|${e.match.tool ? `tool=${e.match.tool.toLowerCase()}` : 'any-tool'}`;
  return `${head}|advisory:${e.match.advisory.toUpperCase()}`;
}

function uniqueIdsAndSelectors(file: { exceptions: ExceptionEntry[] }, ctx: z.RefinementCtx): void {
  const ids = new Set<string>();
  const selectors = new Map<string, string>();
  file.exceptions.forEach((e, i) => {
    if (ids.has(e.id)) {
      ctx.addIssue({
        code: 'custom',
        message: `duplicate id "${e.id}"`,
        path: ['exceptions', i, 'id'],
      });
    }
    ids.add(e.id);
    const key = selectorKey(e);
    const first = selectors.get(key);
    if (first) {
      ctx.addIssue({
        code: 'custom',
        message: `duplicate selector (same as "${first}")`,
        path: ['exceptions', i, 'match'],
      });
    } else selectors.set(key, e.id);
  });
}

export const ExceptionsFileSchema = z
  .object({ schemaVersion: z.literal('1.0'), exceptions: z.array(ExceptionEntrySchema).max(500) })
  .strict()
  .superRefine(uniqueIdsAndSelectors);
export type ExceptionsFile = z.infer<typeof ExceptionsFileSchema>;

export const ExceptionStateSchema = z.enum(['active', 'expired', 'stale', 'unverifiable']);
export type ExceptionState = z.infer<typeof ExceptionStateSchema>;

// ---------------------------------------------------------------------------------------------
// Policy decision cases (config/policy-cases/*.yaml)
// ---------------------------------------------------------------------------------------------

/** An ISO instant or a "@now±N(d|h|m)" token relative to the case clock. */
const instantOrToken = z.union([
  z.iso.datetime({ offset: true }),
  z.string().regex(/^@now([+-]\d{1,6}[mhd])?$/),
]);
/** A YYYY-MM-DD date or a "@now±N(d|h|m)" token (cases and the mock fixture only). */
const dateOrToken = z.union([ExceptionDateSchema, z.string().regex(/^@now([+-]\d{1,6}[mhd])?$/)]);

const CaseFindingSchema = z
  .object({
    /** "<owner>/<repo>#<code-scanning|dependabot|secret-scanning>#<number>". */
    id: z
      .string()
      .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+#(code-scanning|dependabot|secret-scanning)#\d+$/),
    severity: SeveritySchema,
    status: z.enum(['open', 'fixed', 'dismissed']).default('open'),
    detectedAt: instantOrToken.nullable().default(null),
    ruleId: z.string().max(200).optional(),
    tool: z.string().max(50).optional(),
    advisoryIds: z.array(z.string().max(100)).max(10).optional(),
  })
  .strict();

const CaseExceptionSchema = withSelectorChecks(
  z.object({ ...exceptionFields, created: dateOrToken, expires: dateOrToken }).strict(),
);

export const PolicyCaseSchema = z
  .object({
    name: z.string().min(1).max(200),
    kind: z.enum(['security', 'overall']),
    now: z.iso.datetime({ offset: true }).optional(),
    security: z
      .object({
        findings: z.array(CaseFindingSchema).max(200).default([]),
        exceptions: z.array(CaseExceptionSchema).max(100).default([]),
        /** "owner/repo|source" pairs whose alert source was not readable. */
        unreadable: z
          .array(
            z
              .string()
              .regex(
                /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\|(code-scanning|dependabot|secret-scanning)$/,
              ),
          )
          .max(50)
          .default([]),
      })
      .strict()
      .optional(),
    overall: z
      .object({ dimensions: z.record(DimensionSchema, HealthStatusSchema) })
      .strict()
      .optional(),
    expect: z
      .object({
        status: HealthStatusSchema,
        reasons: z.array(z.string().max(80)).max(50).optional(),
        absent: z.array(z.string().max(80)).max(50).optional(),
        score: z.number().int().min(0).max(100).nullable().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.kind === 'security' && !c.security)
      ctx.addIssue({
        code: 'custom',
        message: 'kind "security" needs a security block',
        path: ['security'],
      });
    if (c.kind === 'overall' && !c.overall)
      ctx.addIssue({
        code: 'custom',
        message: 'kind "overall" needs an overall block',
        path: ['overall'],
      });
  });
export type PolicyCase = z.infer<typeof PolicyCaseSchema>;
