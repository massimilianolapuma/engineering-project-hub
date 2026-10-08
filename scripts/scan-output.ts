/**
 * Publication gate: scans the static build and the published data for credential
 * patterns and for the values of credentials present in the environment.
 * Only file names and pattern names are printed, never the matched value.
 * Usage: tsx scripts/scan-output.ts [dir...]   (default: dist public/data)
 */
import { open, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { findSecretPatterns, sensitiveEnvValues } from '../shared/security/patterns';

const TEXT_EXT = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.txt',
  '.xml',
  '.md',
  '.svg',
  '.map',
  '.webmanifest',
]);
export const MAX_SCAN_BYTES = 20 * 1024 * 1024;
const FORBIDDEN_FILES = [/\.env(\..*)?$/, /\.pem$/, /\.key$/, /id_rsa/, /\.npmrc$/];

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

export async function scan(dirs: string[]): Promise<{ files: number; findings: string[] }> {
  const envValues = sensitiveEnvValues();
  const findings: string[] = [];
  let files = 0;
  for (const dir of dirs) {
    for await (const file of walk(dir)) {
      if (FORBIDDEN_FILES.some((r) => r.test(file))) findings.push(`${file}: forbidden file type`);
      if (!TEXT_EXT.has(extname(file).toLowerCase())) continue;
      files++;
      // One handle for both the size check and the read (no check-then-use race), and an
      // oversized file is a finding: it must never escape the scan silently.
      const handle = await open(file, 'r');
      let text: string;
      try {
        if ((await handle.stat()).size > MAX_SCAN_BYTES) {
          findings.push(`${file}: too large to scan (> ${MAX_SCAN_BYTES} bytes)`);
          continue;
        }
        text = await handle.readFile('utf8');
      } finally {
        await handle.close();
      }
      for (const name of findSecretPatterns(text)) findings.push(`${file}: ${name}`);
      if (envValues.some((v) => text.includes(v))) findings.push(`${file}: environment-credential`);
    }
  }
  return { files, findings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['dist', 'public/data'];
  const { files, findings } = await scan(dirs);
  if (findings.length) {
    console.error(
      `✖ Secret scan failed (${findings.length} finding(s)):\n${findings.map((f) => `  - ${f}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log(
    `✔ Secret scan: ${files} file(s) in ${dirs.join(', ')} — no credential patterns found`,
  );
}
