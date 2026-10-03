/**
 * Generates JSON Schemas from the Zod models for editor validation of the YAML config
 * (yaml-language-server) and for consumers of the published snapshots.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  CatalogSchema,
  PoliciesSchema,
  PortfolioIndexSchema,
  ProjectSnapshotSchema,
  ReleaseManifestSchema,
  SecurityStatusFileSchema,
} from '../shared/model';

const targets: [string, z.ZodType][] = [
  ['projects.schema.json', CatalogSchema],
  ['policies.schema.json', PoliciesSchema],
  ['security-status.schema.json', SecurityStatusFileSchema],
  ['release-manifest.schema.json', ReleaseManifestSchema],
  ['snapshot-index.schema.json', PortfolioIndexSchema],
  ['project-snapshot.schema.json', ProjectSnapshotSchema],
];
await mkdir('config/schema', { recursive: true });
for (const [file, schema] of targets) {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  await writeFile(`config/schema/${file}`, `${JSON.stringify(json, null, 2)}\n`);
}
console.log(`✔ ${targets.length} JSON Schemas written to config/schema/`);
