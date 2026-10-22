/**
 * Validates the catalog (config/catalog.yaml + config/projects/*.yaml, or the legacy
 * config/projects.yaml), config/policies.yaml and the optional config/exceptions.yaml against
 * the Zod schemas.
 * Usage: tsx scripts/validate-config.ts [configDir]
 */
import { ConfigError, loadConfig } from '../collector/src/config/load';

const dir = process.argv[2] ?? 'config';
try {
  const { catalog, policies, exceptions } = await loadConfig(dir);
  const repos = new Set(
    catalog.projects.flatMap((p) => [
      p.coordinator.repository,
      ...p.components.map((c) => c.repository),
    ]),
  );
  console.log(
    `✔ ${dir}: ${catalog.projects.length} project(s), ${repos.size} repositories, discovery ${catalog.discovery.enabled ? `on (${catalog.discovery.owners.join(', ') || 'no owners'})` : 'off'}`,
  );
  console.log(
    `✔ ${dir}/policies.yaml: schema ${policies.schemaVersion}, audience=${policies.publication.audience}`,
  );
  if (exceptions.file) {
    console.log(`✔ ${dir}/exceptions.yaml: ${exceptions.file.exceptions.length} exception(s)`);
    for (const w of exceptions.warnings) console.warn(`⚠ ${w.path}: ${w.message}`);
  }
} catch (e) {
  console.error(e instanceof ConfigError ? `✖ ${e.message}` : `✖ ${(e as Error).message}`);
  process.exit(1);
}
