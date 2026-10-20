import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { PoliciesSchema, type Policies } from '@model/index';

/*
 * Build-time read of the health policies, used only to explain them on the "How to read"
 * page (weights, caps, thresholds). Health and score are still computed by the collector:
 * the site never re-evaluates anything. POLICIES_FILE points at the policies of a separate
 * configuration (e.g. a deploy repository) and must then be readable and valid. Only when
 * POLICIES_FILE is unset and the hub's own config/policies.yaml is missing does the page fall
 * back to the schema defaults (and says so). An unreadable or invalid file fails the build,
 * so the page never explains policies nobody configured.
 */
const DEFAULT_FILE = 'config/policies.yaml';

/** Every section empty: PoliciesSchema fills in its defaults. */
const DEFAULTS_INPUT = {
  schemaVersion: '1.0',
  freshness: {},
  delivery: {},
  security: {},
  coverage: {},
  version: {},
  governance: {},
  overall: {},
  publication: {},
} as const;

export interface SitePolicies {
  policies: Policies;
  /** "file" when read from the policies file, "defaults" when the default file was missing. */
  source: 'file' | 'defaults';
}

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';

export function loadSitePolicies(): SitePolicies {
  const explicit = process.env.POLICIES_FILE;
  const file = resolve(explicit || DEFAULT_FILE);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (!explicit && isMissing(err)) {
      console.warn(`[engineering-project-hub] no policies at ${file}: schema defaults shown`);
      return { policies: PoliciesSchema.parse(DEFAULTS_INPUT), source: 'defaults' };
    }
    throw new Error(`Policies not readable at ${file} (POLICIES_FILE): ${String(err)}`, {
      cause: err,
    });
  }
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    throw new Error(`Policies at ${file} are not valid YAML: ${String(err)}`, { cause: err });
  }
  const parsed = PoliciesSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid policies in ${file}: ${issues}`);
  }
  return { policies: parsed.data, source: 'file' };
}
