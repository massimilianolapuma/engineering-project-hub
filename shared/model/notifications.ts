import { z } from 'zod';
import { DimensionSchema } from './enums';

/*
 * <configDir>/notifications.yaml (spec §5.5.1, ADR 0013). Infrastructure, never published.
 * v0.15.0 supports Microsoft Teams only; strict at every level, so a Jira or Azure DevOps block
 * is a config error until those targets exist.
 */

const AlertSeverity = z.enum(['critical', 'high']);

/** https only, no query or fragment, ends with "/": the only link host a digest may contain. */
const SiteUrl = z
  .string()
  .max(200)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (
        u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        !v.includes('?') &&
        !v.includes('#') &&
        v.endsWith('/')
      );
    } catch {
      return false;
    }
  }, 'siteUrl must be an https URL with no query or fragment, ending with "/"');

/** A host suffix in the hostAllowed convention: no leading dot, lower case. */
const HostSuffix = z
  .string()
  .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'a host suffix such as environment.api.powerplatform.com');

export const NotificationsConfigSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    /** send also needs the repository variable HUB_NOTIFICATIONS=send (and real, compared data). */
    mode: z.enum(['dry-run', 'send']).default('dry-run'),
    locale: z.enum(['en', 'it']).default('en'),
    siteUrl: SiteUrl.nullable().default(null),
    trigger: z
      .object({
        overallWorsened: z.boolean().default(true),
        becameUnknown: z.boolean().default(true),
        dimensionsWorsened: z.array(DimensionSchema).default(['security', 'delivery']),
        newFindings: z
          .object({
            severities: z.array(AlertSeverity).default(['critical']),
            min: z.number().int().min(1).default(1),
          })
          .strict()
          .prefault({}),
        newlyOverdue: z
          .object({
            severities: z.array(AlertSeverity).default(['critical', 'high']),
            min: z.number().int().min(1).default(1),
          })
          .strict()
          .prefault({}),
        /** 0 = new collection errors never trigger. */
        newErrors: z
          .object({ min: z.number().int().min(0).default(0) })
          .strict()
          .prefault({}),
        /** 0 = expired exceptions never trigger. */
        expiredExceptions: z
          .object({ min: z.number().int().min(0).default(1) })
          .strict()
          .prefault({}),
      })
      .strict()
      .prefault({}),
    digest: z
      .object({ maxProjects: z.number().int().min(1).max(50).default(10) })
      .strict()
      .prefault({}),
    targets: z
      .object({
        teams: z
          .object({
            enabled: z.boolean().default(false),
            allowedHostSuffixes: z
              .array(HostSuffix)
              .min(1)
              .max(5)
              .default(['environment.api.powerplatform.com']),
          })
          .strict()
          .prefault({}),
      })
      .strict()
      .prefault({}),
  })
  .strict();
export type NotificationsConfig = z.infer<typeof NotificationsConfigSchema>;
