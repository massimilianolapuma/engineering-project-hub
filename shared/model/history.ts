import { z } from 'zod';
import {
  AuthenticationModeSchema,
  DataSourceSchema,
  DimensionSchema,
  ErrorClassificationSchema,
  FindingSourceSchema,
  HealthStatusSchema,
  RepositoryCheckIdSchema,
} from './enums';
import { RepositoryRefSchema } from './catalog';
import { httpsUrl, nullableCount, shortText, utcDate } from './primitives';
import { CollectionErrorSchema } from './snapshot';

/*
 * History (history.json) and changes (changes.json) are separate published files with their own
 * kind and schemaVersion: the history is the only input that crosses runs and releases, so it
 * must not be tied to the snapshot version. Every object is `.strict()` (publication allowlist).
 */

/** The same instant as an ISO date in UTC ("Z", milliseconds), as history and changes store it. */
export const toUtc = (iso: string): string => new Date(iso).toISOString();

// 1.1: repository controls counts per point and check states in the baseline (optional).
export const HISTORY_SCHEMA_VERSION = '1.1';
export const SUPPORTED_HISTORY_SCHEMA_VERSIONS = ['1.0', '1.1'] as const;
export const CHANGES_SCHEMA_VERSION = '1.0';

/** How the previous history was obtained for a run. */
export const HistoryRestoreStateSchema = z.enum([
  'restored',
  'fixture',
  'none',
  'restore-failed',
  'unreadable',
  'incompatible',
  'source-changed',
]);
export type HistoryRestoreState = z.infer<typeof HistoryRestoreStateSchema>;

/** What changes.json was computed from; anything but "compared" is a fresh start. */
export const ChangesBasisStateSchema = z.enum([
  'compared',
  'none',
  'restore-failed',
  'unreadable',
  'incompatible',
  'source-changed',
]);
export type ChangesBasisState = z.infer<typeof ChangesBasisStateSchema>;

const projectId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
/** Catalog component id (or "coordinator"). */
const componentId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
/** The collector's package version, semver-like. Restored files are checked against it. */
export const COLLECTOR_VERSION_PATTERN = /^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-[0-9A-Za-z.-]{1,30})?$/;
const score = z.number().int().min(0).max(100);
const count = z.number().int().min(0);

export const HistoryProjectPointSchema = z
  .object({
    id: projectId,
    overall: HealthStatusSchema,
    /** null = insufficient data, never 0. */
    score: score.nullable(),
    scoreMeasured: count,
    scoreRequired: count,
    /** A missing key means the dimension was not tracked then (older collector), not grey. */
    dimensions: z.partialRecord(DimensionSchema, HealthStatusSchema),
    open: z
      .object({
        critical: nullableCount,
        high: nullableCount,
        medium: nullableCount,
        low: nullableCount,
      })
      .strict(),
    countsComplete: z.boolean(),
    collectionErrors: count,
    /** Repository checks of the run (absent in 1.0 files). */
    controls: z.object({ passed: count, failed: count, unknown: count }).strict().optional(),
  })
  .strict();
export type HistoryProjectPoint = z.infer<typeof HistoryProjectPointSchema>;

export const HistoryEntrySchema = z
  .object({
    /** index.generatedAt of that run. */
    collectedAt: utcDate,
    dataSource: DataSourceSchema,
    authenticationMode: AuthenticationModeSchema,
    collectorVersion: z.string().max(50).regex(COLLECTOR_VERSION_PATTERN),
    projects: z.array(HistoryProjectPointSchema).max(500),
  })
  .strict();
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

/** Only for the latest entry: the small state the next run needs to compute its diff. */
export const HistoryBaselineSchema = z
  .object({
    collectedAt: utcDate,
    projects: z
      .array(
        z
          .object({
            id: projectId,
            /**
             * Repositories whose alerts were collected in that run (the project's security
             * controls). An alert of a repository monitored in only one of the two runs is
             * never compared: a catalog change is not a new or resolved alert.
             */
            repositories: z.array(RepositoryRefSchema).max(500),
            /** Open critical/high alerts, at most 500 per project. */
            findings: z
              .array(
                z
                  .object({
                    id: z.string().max(200),
                    severity: z.enum(['critical', 'high']),
                    componentId,
                    repository: RepositoryRefSchema,
                    source: FindingSourceSchema,
                    htmlUrl: httpsUrl.nullable(),
                  })
                  .strict(),
              )
              .max(500),
            /** "owner/repo|source" pairs whose alerts could not be read in that run. */
            unreadable: z.array(z.string().max(250)).max(500),
            versions: z
              .array(
                z
                  .object({
                    kind: z.enum(['coordinator', 'component']),
                    /** null for the coordinator. */
                    componentId: z.string().max(64).nullable(),
                    version: z.string().max(100).nullable(),
                  })
                  .strict(),
              )
              .max(200),
            /** "owner/repo|source|classification" keys of the run's collection errors. */
            errors: z.array(z.string().max(300)).max(500),
            /**
             * "owner/repo|check|pass" or "owner/repo|check|fail" keys (unknown and not applicable
             * are left out). Absent in 1.0 files: nothing to compare.
             */
            checks: z.array(z.string().max(320)).max(600).optional(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
export type HistoryBaseline = z.infer<typeof HistoryBaselineSchema>;

export const HistoryFileSchema = z
  .object({
    kind: z.literal('hub-history'),
    schemaVersion: z.enum(SUPPORTED_HISTORY_SCHEMA_VERSIONS),
    generatedAt: utcDate,
    retention: z.object({ maxEntries: z.number().int(), maxAgeDays: z.number().int() }).strict(),
    restore: z.object({ state: HistoryRestoreStateSchema, previousEntries: count }).strict(),
    /** Oldest to newest. */
    entries: z.array(HistoryEntrySchema).min(1).max(1000),
    baseline: HistoryBaselineSchema,
  })
  .strict()
  .refine((f) => Date.parse(f.baseline.collectedAt) === Date.parse(f.entries.at(-1)!.collectedAt), {
    message: 'baseline must describe the latest entry',
    path: ['baseline'],
  })
  .refine(
    (f) =>
      f.entries.every(
        (e, i) => i === 0 || Date.parse(e.collectedAt) > Date.parse(f.entries[i - 1]!.collectedAt),
      ),
    {
      message: 'entries must be strictly increasing by collectedAt',
      path: ['entries'],
    },
  );
export type HistoryFile = z.infer<typeof HistoryFileSchema>;

/** Loose probe for the kind / version check before a full parse. */
export const HistoryProbeSchema = z.object({ kind: z.string(), schemaVersion: z.string() });

const changeFinding = {
  id: z.string().max(200),
  severity: z.enum(['critical', 'high']),
  componentId: z.string().max(64),
  repository: z.string().max(200),
  htmlUrl: httpsUrl.nullable(),
};

const projectStatus = z.object({ overall: HealthStatusSchema, score: score.nullable() }).strict();

export const ChangesFileSchema = z
  .object({
    kind: z.literal('hub-changes'),
    schemaVersion: z.literal(CHANGES_SCHEMA_VERSION),
    generatedAt: utcDate,
    basis: z
      .object({
        state: ChangesBasisStateSchema,
        previousCollectedAt: utcDate.nullable(),
        /** true when the previous points are mock fixtures. */
        synthetic: z.boolean(),
      })
      .strict(),
    totals: z
      .object({
        statusChanges: count,
        newFindings: count,
        resolvedFindings: count,
        versionMoves: count,
        newErrors: count,
        /** Written by 0.8.0 and later. */
        checkChanges: count.optional(),
      })
      .strict(),
    projects: z.array(
      z
        .object({
          id: projectId,
          /** Not in the previous entry: nothing compared. */
          added: z.boolean(),
          previous: projectStatus.nullable(),
          current: projectStatus,
          statusChanges: z.array(
            z
              .object({
                dimension: z.union([DimensionSchema, z.literal('overall')]),
                from: HealthStatusSchema,
                to: HealthStatusSchema,
              })
              .strict(),
          ),
          newFindings: z
            .array(z.object({ ...changeFinding, title: shortText.nullable() }).strict())
            .max(50),
          resolvedFindings: z.array(z.object(changeFinding).strict()).max(50),
          findingsTruncated: count,
          /** Some (repository, source) pairs were unreadable in one of the two runs: not compared. */
          findingsPartial: z.boolean(),
          versionMoves: z.array(
            z
              .object({
                kind: z.enum(['coordinator', 'component']),
                componentId: z.string().max(64).nullable(),
                from: z.string().max(100),
                to: z.string().max(100),
              })
              .strict(),
          ),
          newErrors: z.array(
            z
              .object({
                repository: z.string().max(200),
                source: CollectionErrorSchema.shape.source,
                classification: ErrorClassificationSchema,
              })
              .strict(),
          ),
          resolvedErrors: count,
          /** Repository checks that moved pass ↔ fail (both runs known), at most 50. */
          checkChanges: z
            .array(
              z
                .object({
                  repository: z.string().max(200),
                  check: RepositoryCheckIdSchema,
                  from: z.enum(['pass', 'fail']),
                  to: z.enum(['pass', 'fail']),
                })
                .strict(),
            )
            .max(50)
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type ChangesFile = z.infer<typeof ChangesFileSchema>;
