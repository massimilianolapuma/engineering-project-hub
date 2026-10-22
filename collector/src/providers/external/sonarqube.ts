import { z } from 'zod';
import { fail, ok, type ProviderResult } from '../types';
import type { ExternalClient } from './http';
import type { QualityProvider, SonarProjectDTO } from './types';

const METRIC_KEYS = 'alert_status,lines_to_cover,uncovered_lines,new_coverage';
const FULL_SHA = /^[0-9a-f]{40}$/;
const isoDate = z.iso.datetime({ offset: true });

/** Only the fields the hub reads; anything else in the response is ignored, never kept. */
const MeasureSchema = z.object({
  metric: z.string(),
  value: z.string().optional(),
  period: z.object({ value: z.string().optional() }).optional(),
  periods: z.array(z.object({ value: z.string().optional() })).optional(),
});
const MeasuresResponseSchema = z.object({
  component: z.object({ measures: z.array(MeasureSchema) }),
});
const AnalysesResponseSchema = z.object({
  analyses: z.array(z.object({ date: z.string().optional(), revision: z.string().optional() })),
});
type Measure = z.infer<typeof MeasureSchema>;

const invalid = (): ProviderResult<never> =>
  fail({ classification: 'invalid-data', message: 'invalid response' });

/** A non-negative integer, or null (a value the hub cannot trust is unknown, never 0). */
function count(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function percentage(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/** SonarQube dates look like 2017-03-01T11:39:03+0100: add the colon of the offset. */
export function normaliseSonarDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const fixed = raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  return isoDate.safeParse(fixed).success ? fixed : null;
}

/**
 * SonarQube Web API, read-only (Browse permission). The quality gate comes from the
 * `alert_status` measure: `api/qualitygates/project_status` is deprecated on SonarQube Cloud and
 * is never called.
 */
export function createSonarQubeProvider(client: ExternalClient): QualityProvider {
  return {
    id: 'sonarqube',
    async getProject(key, branch) {
      const branchQuery: Record<string, string> = branch ? { branch } : {};
      const measures = await client.getJson(
        '/api/measures/component',
        {},
        {
          component: key,
          metricKeys: METRIC_KEYS,
          ...branchQuery,
        },
      );
      if (!measures.ok) return measures;
      const parsed = MeasuresResponseSchema.safeParse(measures.data);
      if (!parsed.success) return invalid();

      const analyses = await client.getJson(
        '/api/project_analyses/search',
        {},
        {
          project: key,
          ps: '1',
          ...branchQuery,
        },
      );
      if (!analyses.ok) return analyses;
      const analysesParsed = AnalysesResponseSchema.safeParse(analyses.data);
      if (!analysesParsed.success) return invalid();

      const byMetric = new Map<string, Measure>(
        parsed.data.component.measures.map((m) => [m.metric, m]),
      );
      const value = (metric: string) => byMetric.get(metric)?.value;
      const gate = value('alert_status');
      const newCode = byMetric.get('new_coverage');
      const last = analysesParsed.data.analyses[0];
      const dto: SonarProjectDTO = {
        linesToCover: count(value('lines_to_cover')),
        uncoveredLines: count(value('uncovered_lines')),
        // Servers report new-code measures under value, period or periods[0].
        newCoverage: percentage(
          newCode?.value ?? newCode?.period?.value ?? newCode?.periods?.[0]?.value,
        ),
        qualityGate: gate === 'OK' || gate === 'ERROR' ? gate : null,
        analysedAt: normaliseSonarDate(last?.date),
        revision: last?.revision && FULL_SHA.test(last.revision) ? last.revision : null,
      };
      return ok(dto);
    },
  };
}
