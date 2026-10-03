/**
 * Validates every published snapshot (index.json + projects/*.json) against the strict
 * schemas, checks schemaVersion support and cross-references, and re-runs the
 * sanitisation gate. Usage: tsx scripts/validate-snapshots.ts [dataDir]
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validatePortfolio, validateProject } from '../src/lib/validate';
import { assertPublishable } from '../collector/src/sanitizers/sanitize';

const dir = process.argv[2] ?? process.env.SNAPSHOT_DIR ?? 'public/data';
const problems: string[] = [];

async function read(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    problems.push(`${file}: missing`);
    return null;
  }
}

const indexText = await read(join(dir, 'index.json'));
const index = indexText ? validatePortfolio(indexText) : null;
if (index && !index.ok) problems.push(`index.json: ${index.error.message}`);

let projectFiles: string[] = [];
try {
  projectFiles = (await readdir(join(dir, 'projects'))).filter((f) => f.endsWith('.json'));
} catch {
  problems.push('projects/: missing');
}
for (const f of projectFiles) {
  const text = await read(join(dir, 'projects', f));
  if (!text) continue;
  const res = validateProject(text);
  if (!res.ok) problems.push(`projects/${f}: ${res.error.message}`);
  else if (`${res.data.project.id}.json` !== f)
    problems.push(`projects/${f}: file name does not match project id`);
  try {
    assertPublishable(text, `projects/${f}`);
  } catch (e) {
    problems.push((e as Error).message);
  }
}
if (index?.ok) {
  for (const p of index.data.projects) {
    if (!projectFiles.includes(`${p.id}.json`))
      problems.push(`index.json references missing project file ${p.id}.json`);
  }
  try {
    assertPublishable(indexText!, 'index.json');
  } catch (e) {
    problems.push((e as Error).message);
  }
}

if (problems.length) {
  console.error(
    `✖ Snapshot validation failed (${dir}):\n${problems.map((p) => `  - ${p}`).join('\n')}`,
  );
  process.exit(1);
}
console.log(`✔ ${dir}: index.json + ${projectFiles.length} project snapshot(s) valid`);
