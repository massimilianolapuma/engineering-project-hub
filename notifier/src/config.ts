import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { NotificationsConfigSchema, type NotificationsConfig } from '@model/index';

export class NotificationsConfigError extends Error {
  override readonly name = 'NotificationsConfigError';
}

/**
 * Reads <configDir>/notifications.yaml. A missing file means "not configured" (null); an
 * unreadable or invalid file throws with the field paths, never the file's values.
 */
export function loadNotificationsConfig(configDir: string): NotificationsConfig | null {
  const file = join(configDir, 'notifications.yaml');
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new NotificationsConfigError(`${file}: not readable`);
  }
  let raw: unknown;
  try {
    raw = parse(text);
  } catch {
    throw new NotificationsConfigError(`${file}: not valid YAML`);
  }
  const parsed = NotificationsConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new NotificationsConfigError(`${file} is invalid:\n  - ${paths.join('\n  - ')}`);
  }
  return parsed.data;
}
