import {
  PortfolioIndexSchema,
  ProjectSnapshotSchema,
  SUPPORTED_SNAPSHOT_SCHEMA_VERSIONS,
  VersionProbeSchema,
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
