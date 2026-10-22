import { z } from 'zod';
import { ProviderIdSchema, type ProviderId } from './enums';

/**
 * config/providers.yaml: optional external providers (SonarQube, Harbor, Argo CD). Everything is
 * off unless the owner opts in. The file is never published: base URLs are infrastructure
 * details. Credentials come from the environment, never from this file.
 */

/** https only, no credentials, query or fragment; path limited to an optional context root. */
function isBaseUrl(raw: string): boolean {
  const match = /^https:\/\/([^/?#@]+)(\/[^?#]*)?$/.exec(raw);
  if (!match) return false;
  const path = match[2] ?? '';
  if (!/^(?:\/[A-Za-z0-9._-]+)*\/?$/.test(path)) return false;
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && url.host !== '';
  } catch {
    return false;
  }
}

const ProviderConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** https, no credentials, no query; an optional context root ("/sonar") is allowed. */
    baseUrl: z
      .string()
      .max(200)
      .refine(isBaseUrl, 'must be an https URL without credentials, query or fragment')
      .optional(),
    timeoutSeconds: z.number().int().min(1).max(60).default(20),
    /** Items read per run (project keys, image references or applications). */
    maxItems: z.number().int().min(1).max(1000).default(200),
  })
  .strict()
  .refine((p) => !p.enabled || p.baseUrl !== undefined, {
    message: 'baseUrl is required when the provider is enabled',
    path: ['baseUrl'],
  });
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ProvidersFileSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    sonarqube: ProviderConfigSchema.prefault({}),
    harbor: ProviderConfigSchema.prefault({}),
    argocd: ProviderConfigSchema.prefault({}),
  })
  .strict();
export type ProvidersFile = z.infer<typeof ProvidersFileSchema>;

export const PROVIDER_IDS: readonly ProviderId[] = ProviderIdSchema.options;

/** No file, or a file with nothing enabled: no external host is ever contacted. */
export const PROVIDERS_OFF: ProvidersFile = ProvidersFileSchema.parse({ schemaVersion: '1.0' });
