import {
  QualitySummarySchema,
  type CollectionError,
  type ComponentType,
  type Policies,
  type QualityReportState,
  type TestCoverage,
} from '@model/index';
import type { SonarProjectDTO } from '../providers/external/types';
import type { ProviderResult, QualitySummaryArtifactDTO } from '../providers/types';
import { sanitizeUrl, scrubIdentifier } from '../sanitizers/sanitize';
import { ageMs, DAY_MS } from '../util/clock';
import { toCollectionError } from './model';

export type RepoQualityState = Exclude<QualityReportState, 'not-applicable'>;

/** Quality report of one repository, read from its `hub-quality-summary` artifact. */
export interface RepoQuality {
  repository: string;
  state: RepoQualityState;
  linesCovered: number | null;
  linesValid: number | null;
  commitSha: string | null;
  generatedAt: string | null;
  tool: string | null;
  runUrl: string | null;
}

const SOURCE = 'quality-summary' satisfies CollectionError['source'];

function notVisible(repository: string, state: RepoQualityState): RepoQuality {
  return {
    repository,
    state,
    linesCovered: null,
    linesValid: null,
    commitSha: null,
    generatedAt: null,
    tool: null,
    runUrl: null,
  };
}

/** The summary is unusable: report it as invalid without echoing any of its content. */
function invalid(repository: string, detail: string) {
  return {
    quality: notVisible(repository, 'invalid'),
    error: toCollectionError(repository, undefined, SOURCE, {
      classification: 'invalid-data',
      message: detail,
    }),
  };
}

/**
 * Classifies the provider result and validates the summary (strict schema, same repository).
 * Not found → missing; expired → expired; 403 → not-authorised; invalid → invalid plus an
 * invalid-data error; anything else → unknown. A valid report older than
 * freshness.qualityReportStaleDays is stale (still counted).
 */
export function normaliseQualitySummary(
  repository: string,
  result: ProviderResult<QualitySummaryArtifactDTO>,
  policies: Policies,
  now: Date,
): { quality: RepoQuality; error: CollectionError | null } {
  if (!result.ok) {
    const { classification, skipped } = result.error;
    // Repository itself not accessible: already reported once, the report is unknown.
    if (skipped) return { quality: notVisible(repository, 'unknown'), error: null };
    if (classification === 'not-found')
      return { quality: notVisible(repository, 'missing'), error: null };
    const state: RepoQualityState =
      classification === 'not-authorised'
        ? 'not-authorised'
        : classification === 'invalid-data'
          ? 'invalid'
          : 'unknown';
    return {
      quality: notVisible(repository, state),
      error: toCollectionError(repository, undefined, SOURCE, result.error),
    };
  }

  const { summaryText, runUrl } = result.data;
  if (summaryText === null) return { quality: notVisible(repository, 'expired'), error: null };

  let raw: unknown;
  try {
    raw = JSON.parse(summaryText);
  } catch {
    return invalid(repository, 'quality-summary.json is not valid JSON');
  }
  const parsed = QualitySummarySchema.safeParse(raw);
  if (!parsed.success)
    return invalid(repository, 'quality-summary.json does not match the 1.0 contract');
  const summary = parsed.data;
  if (summary.repository.toLowerCase() !== repository.toLowerCase())
    return invalid(repository, 'quality-summary.json names a different repository');

  const age = ageMs(summary.generatedAt, now);
  const stale = age !== null && age > policies.freshness.qualityReportStaleDays * DAY_MS;
  return {
    quality: {
      repository,
      state: stale ? 'stale' : 'readable',
      linesCovered: summary.lines.covered,
      linesValid: summary.lines.valid,
      commitSha: summary.commitSha,
      generatedAt: summary.generatedAt,
      tool: scrubIdentifier(summary.tool, 40),
      runUrl: sanitizeUrl(runUrl, policies.publication.allowedLinkHosts),
    },
    error: null,
  };
}

/** SonarQube report of one project key (the key is carried in `repository`, never published). */
export interface SonarQuality extends RepoQuality {
  source: 'sonarqube';
  qualityGate: 'passed' | 'failed' | null;
  newCoverage: number | null;
}

const SONAR = 'sonarqube' satisfies CollectionError['source'];

function sonarNotVisible(key: string, state: RepoQualityState): SonarQuality {
  return {
    ...notVisible(key, state),
    source: 'sonarqube',
    qualityGate: null,
    newCoverage: null,
  };
}

/**
 * Maps a SonarQube project to a quality report: linesValid = lines_to_cover, linesCovered =
 * lines_to_cover − uncovered_lines. A missing measure is unknown, a negative or larger-than-total
 * uncovered count is invalid. 404 → missing (the key is not visible: never counted, never 0),
 * 401/403 → not-authorised. Older than qualityReportStaleDays → stale.
 */
export function normaliseSonarProject(
  key: string,
  result: ProviderResult<SonarProjectDTO>,
  policies: Policies,
  now: Date,
): { quality: SonarQuality; error: CollectionError | null } {
  if (!result.ok) {
    const { classification, skipped } = result.error;
    if (skipped) return { quality: sonarNotVisible(key, 'unknown'), error: null };
    if (classification === 'not-found')
      return { quality: sonarNotVisible(key, 'missing'), error: null };
    const state: RepoQualityState =
      classification === 'not-authorised'
        ? 'not-authorised'
        : classification === 'invalid-data'
          ? 'invalid'
          : 'unknown';
    return {
      quality: sonarNotVisible(key, state),
      error: toCollectionError(key, undefined, SONAR, result.error),
    };
  }
  const p = result.data;
  if (p.linesToCover === null || p.uncoveredLines === null)
    return { quality: sonarNotVisible(key, 'unknown'), error: null };
  if (p.uncoveredLines > p.linesToCover) {
    return {
      quality: sonarNotVisible(key, 'invalid'),
      error: toCollectionError(key, undefined, SONAR, {
        classification: 'invalid-data',
        message: 'SonarQube reports more uncovered lines than lines to cover',
      }),
    };
  }
  const age = ageMs(p.analysedAt, now);
  const stale = age !== null && age > policies.freshness.qualityReportStaleDays * DAY_MS;
  return {
    quality: {
      repository: key,
      state: stale ? 'stale' : 'readable',
      linesCovered: p.linesToCover - p.uncoveredLines,
      linesValid: p.linesToCover,
      commitSha: p.revision,
      generatedAt: p.analysedAt,
      tool: 'sonarqube',
      runUrl: null,
      source: 'sonarqube',
      qualityGate: p.qualityGate === 'OK' ? 'passed' : p.qualityGate === 'ERROR' ? 'failed' : null,
      newCoverage: p.newCoverage,
    },
    error: null,
  };
}

const COVERAGE_TYPES: ReadonlySet<ComponentType | 'coordinator'> = new Set([
  'service',
  'webapp',
  'worker',
  'library',
  'coordinator',
]);

/**
 * Whether test coverage applies: by default to code components (service, webapp, worker,
 * library) and the coordinator; not to deployment, infrastructure and other. The catalog
 * override (`testCoverage`) always wins.
 */
export function isCoverageApplicable(
  type: ComponentType | 'coordinator',
  override?: TestCoverage,
): boolean {
  if (override) return override === 'required';
  return COVERAGE_TYPES.has(type);
}
