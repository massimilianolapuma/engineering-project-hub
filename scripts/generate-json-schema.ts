/**
 * Generates JSON Schemas from the Zod models for editor validation of the YAML config
 * (yaml-language-server) and for consumers of the published snapshots.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  CatalogSchema,
  CatalogSettingsSchema,
  ExceptionsFileSchema,
  PolicyCaseSchema,
  ProjectConfigSchema,
  PoliciesSchema,
  PortfolioIndexSchema,
  ProjectSnapshotSchema,
  QualitySummarySchema,
  ReleaseManifestSchema,
  SecurityStatusFileSchema,
} from '../shared/model';

export const SCHEMA_TARGETS: [string, z.ZodType][] = [
  ['projects.schema.json', CatalogSchema],
  ['project.schema.json', ProjectConfigSchema],
  ['catalog-settings.schema.json', CatalogSettingsSchema],
  ['policies.schema.json', PoliciesSchema],
  ['security-status.schema.json', SecurityStatusFileSchema],
  ['release-manifest.schema.json', ReleaseManifestSchema],
  ['snapshot-index.schema.json', PortfolioIndexSchema],
  ['project-snapshot.schema.json', ProjectSnapshotSchema],
  ['quality-summary.schema.json', QualitySummarySchema],
  ['exceptions.schema.json', ExceptionsFileSchema],
  ['policy-case.schema.json', PolicyCaseSchema],
];

/** The exact text written to config/schema/<file> (with a trailing newline). */
export function renderSchema(schema: z.ZodType): string {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  return `${JSON.stringify(json, null, 2)}\n`;
}

// Only generate when run directly: the drift test imports this module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await mkdir('config/schema', { recursive: true });
  for (const [file, schema] of SCHEMA_TARGETS) {
    await writeFile(`config/schema/${file}`, renderSchema(schema));
  }
  console.log(`✔ ${SCHEMA_TARGETS.length} JSON Schemas written to config/schema/`);
}
