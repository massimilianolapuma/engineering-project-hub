import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { z } from 'zod';
import {
  CatalogSchema,
  CatalogSettingsSchema,
  PoliciesSchema,
  ProjectConfigSchema,
  type Catalog,
  type Policies,
} from '@model/index';

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly file: string,
    readonly issues: string[] = [],
  ) {
    super(issues.length ? `${message}\n${issues.map((i) => `  - ${i}`).join('\n')}` : message);
    this.name = 'ConfigError';
  }
}

/** Human-readable Zod issues: "projects[0].components[1].repository: must be "owner/name"". */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path
      .map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
      .join('');
    return `${path || '(root)'}: ${issue.message}`;
  });
}

export function parseYamlWith<T>(schema: z.ZodType<T>, text: string, file: string): T {
  let raw: unknown;
  try {
    raw = parse(text, { prettyErrors: true });
  } catch (e) {
    throw new ConfigError(`Invalid YAML in ${file}: ${(e as Error).message.split('\n')[0]}`, file);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`Invalid configuration in ${file}:`, file, formatIssues(result.error));
  }
  return result.data;
}

async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    throw new ConfigError(`Cannot read ${file}`, file);
  }
}

export interface LoadedConfig {
  catalog: Catalog;
  policies: Policies;
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Loads the catalog from the config directory. Layout (configuration as code, one document
 * per project so the UI can propose a change as a single-file pull request):
 *   catalog.yaml         optional: discovery settings
 *   projects/<id>.yaml   one ProjectConfig per file (file name = project id)
 *   projects.yaml        legacy single-file catalog, still supported (merged)
 */
export async function loadCatalog(configDir = 'config'): Promise<Catalog> {
  const settingsFile = join(configDir, 'catalog.yaml');
  const settingsText = await readOptional(settingsFile);
  const settings = settingsText
    ? parseYamlWith(CatalogSettingsSchema, settingsText, settingsFile)
    : undefined;

  const projects: unknown[] = [];
  const legacyFile = join(configDir, 'projects.yaml');
  const legacyText = await readOptional(legacyFile);
  let legacyDiscovery: unknown;
  if (legacyText) {
    const legacy = parseYamlWith(CatalogSchema, legacyText, legacyFile);
    projects.push(...legacy.projects);
    legacyDiscovery = legacy.discovery;
  }

  const dir = join(configDir, 'projects');
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => /\.ya?ml$/.test(f)).sort();
  } catch {
    // no per-project directory
  }
  for (const f of files) {
    const file = join(dir, f);
    const project = parseYamlWith(ProjectConfigSchema, await readText(file), file);
    if (f.replace(/\.ya?ml$/, '') !== project.id) {
      throw new ConfigError(`Invalid configuration in ${file}:`, file, [
        `id: must match the file name ("${project.id}.yaml")`,
      ]);
    }
    projects.push(project);
  }

  const merged = CatalogSchema.safeParse({
    discovery: settings?.discovery ?? legacyDiscovery,
    projects,
  });
  if (!merged.success) {
    throw new ConfigError(
      `Invalid catalog in ${configDir}:`,
      configDir,
      formatIssues(merged.error),
    );
  }
  if (!merged.data.projects.length && !merged.data.discovery.enabled) {
    throw new ConfigError(
      `No projects in ${configDir}: add config/projects/<id>.yaml or enable discovery in catalog.yaml`,
      configDir,
    );
  }
  return merged.data;
}

export async function loadConfig(configDir = 'config'): Promise<LoadedConfig> {
  const policiesFile = join(configDir, 'policies.yaml');
  const catalog = await loadCatalog(configDir);
  const policies = parseYamlWith(PoliciesSchema, await readText(policiesFile), policiesFile);
  return { catalog, policies };
}
