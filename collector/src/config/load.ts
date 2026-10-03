import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { z } from 'zod';
import { CatalogSchema, PoliciesSchema, type Catalog, type Policies } from '@model/index';

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

export async function loadConfig(configDir = 'config'): Promise<LoadedConfig> {
  const catalogFile = join(configDir, 'projects.yaml');
  const policiesFile = join(configDir, 'policies.yaml');
  const catalog = parseYamlWith(CatalogSchema, await readText(catalogFile), catalogFile);
  const policies = parseYamlWith(PoliciesSchema, await readText(policiesFile), policiesFile);
  return { catalog, policies };
}
