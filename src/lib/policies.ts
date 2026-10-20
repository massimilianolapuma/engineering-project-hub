import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { PoliciesSchema, type Policies } from '@model/index';

/*
 * Build-time read of the health policies, used only to explain them on the "How to read"
 * page (weights, caps, thresholds). Health and score are still computed by the collector:
 * the site never re-evaluates anything. POLICIES_FILE points at the policies of a separate
 * configuration (e.g. a deploy repository); a missing or invalid file falls back to the
 * schema defaults, so the page never shows numbers that no policy produced.
 */
const policiesFile = () => resolve(process.env.POLICIES_FILE ?? 'config/policies.yaml');

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
  /** "file" when read from the policies file, "defaults" when it was missing or invalid. */
  source: 'file' | 'defaults';
}

export function loadSitePolicies(): SitePolicies {
  const file = policiesFile();
  try {
    const parsed = PoliciesSchema.safeParse(parse(readFileSync(file, 'utf8')));
    if (parsed.success) return { policies: parsed.data, source: 'file' };
    console.warn(`[engineering-project-hub] invalid policies in ${file}: schema defaults shown`);
  } catch {
    console.warn(`[engineering-project-hub] policies not readable at ${file}: defaults shown`);
  }
  return { policies: PoliciesSchema.parse(DEFAULTS_INPUT), source: 'defaults' };
}
