import {
  CatalogSnapshotSchema,
  CHANGES_SCHEMA_VERSION,
  ChangesFileSchema,
  HistoryFileSchema,
  HistoryProbeSchema,
  PortfolioIndexSchema,
  ProjectSnapshotSchema,
  SUPPORTED_HISTORY_SCHEMA_VERSIONS,
  SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS,
  VersionProbeSchema,
  type CatalogSnapshot,
  type ChangesFile,
  type HistoryFile,
  type PortfolioIndex,
  type ProjectSnapshot,
} from '@model/index';
import type { z } from 'zod';

export type DataErrorKind = 'missing' | 'invalid-json' | 'unsupported-schema' | 'invalid';
export interface DataError {
  kind: DataErrorKind;
  message: string;
  schemaVersion?: string;
}
export type Loaded<T> = { ok: true; data: T } | { ok: false; error: DataError };

function validate<T>(schema: z.ZodType<T>, text: string): Loaded<T> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: { kind: 'invalid-json', message: 'snapshot is not valid JSON' } };
  }
  const probe = VersionProbeSchema.safeParse(json);
  if (!probe.success)
    return { ok: false, error: { kind: 'invalid', message: 'snapshot has no schemaVersion' } };
  const version = probe.data.schemaVersion;
  if (!(SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS as readonly string[]).includes(version)) {
    return {
      ok: false,
      error: {
        kind: 'unsupported-schema',
        schemaVersion: version,
        message: `unsupported snapshot schemaVersion "${version}" (supported: ${SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS.join(', ')})`,
      },
    };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: {
        kind: 'invalid',
        message:
          `snapshot does not match schema ${version}: ${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim(),
      },
    };
  }
  return { ok: true, data: parsed.data };
}

export const validatePortfolio = (text: string): Loaded<PortfolioIndex> =>
  validate(PortfolioIndexSchema, text);
export const validateProject = (text: string): Loaded<ProjectSnapshot> =>
  validate(ProjectSnapshotSchema, text);
export const validateCatalogSnapshot = (text: string): Loaded<CatalogSnapshot> =>
  validate(CatalogSnapshotSchema, text);

/**
 * history.json and changes.json carry their own kind and schemaVersion, independent of the
 * snapshot version. The kind literal stops one file being read as the other.
 */
function validateKind<T>(
  schema: z.ZodType<T>,
  text: string,
  kind: 'hub-history' | 'hub-changes',
  supported: readonly string[],
): Loaded<T> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: { kind: 'invalid-json', message: `${kind} is not valid JSON` } };
  }
  const probe = HistoryProbeSchema.safeParse(json);
  if (!probe.success || probe.data.kind !== kind)
    return { ok: false, error: { kind: 'invalid', message: `not a ${kind} file` } };
  const version = probe.data.schemaVersion;
  if (!supported.includes(version)) {
    return {
      ok: false,
      error: {
        kind: 'unsupported-schema',
        schemaVersion: version,
        message: `unsupported ${kind} schemaVersion "${version}" (supported: ${supported.join(', ')})`,
      },
    };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: {
        kind: 'invalid',
        message:
          `${kind} does not match schema ${version}: ${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim(),
      },
    };
  }
  return { ok: true, data: parsed.data };
}

export const validateHistory = (text: string): Loaded<HistoryFile> =>
  validateKind(HistoryFileSchema, text, 'hub-history', SUPPORTED_HISTORY_SCHEMA_VERSIONS);
export const validateChanges = (text: string): Loaded<ChangesFile> =>
  validateKind(ChangesFileSchema, text, 'hub-changes', [CHANGES_SCHEMA_VERSION]);
