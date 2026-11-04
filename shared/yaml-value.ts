import { parse } from 'yaml';

/** Largest versions file parsed (a few lines in practice). */
export const MAX_VALUE_FILE_BYTES = 64 * 1024;

/**
 * The value at a dot path of a YAML or JSON document, as text; null when absent, not scalar, too
 * large or unparsable. Shared by the collector (versions-file signal) and the ledger bridge.
 */
export function valueAt(text: string, key: string): string | null {
  if (text.length > MAX_VALUE_FILE_BYTES) return null;
  let doc: unknown;
  try {
    doc = parse(text, { maxAliasCount: 100, uniqueKeys: false, logLevel: 'error' });
  } catch {
    return null;
  }
  let node: unknown = doc;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' || typeof node === 'number' ? String(node).trim() : null;
}
