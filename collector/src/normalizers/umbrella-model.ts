import type {
  ComponentUmbrella,
  EnvironmentComponentVersions,
  UmbrellaChartState,
  UmbrellaChartSummary,
} from '@model/index';
import type { RawProjectData } from '../collectors/collect';
import { environmentVersionRefs } from '../collectors/umbrella-chart';
import type { FileDTO, ProviderResult } from '../providers/types';
import { scrubIdentifier } from '../sanitizers/sanitize';
import { recordError, type BuildContext } from './model';
import { mapChartToComponents, parseUmbrellaChart, type ChartMapping } from './umbrella-chart';

export interface UmbrellaModel {
  summary: UmbrellaChartSummary | null;
  components: Map<string, ComponentUmbrella>;
  environments: Map<string, EnvironmentComponentVersions>;
}

interface ReadChart {
  state: UmbrellaChartState;
  chartVersion: string | null;
  mapping: ChartMapping | null;
}

function readChart(raw: RawProjectData, result: ProviderResult<FileDTO>): ReadChart {
  if (!result.ok) {
    const c = result.error.classification;
    const state: UmbrellaChartState =
      c === 'not-found' ? 'not-found' : c === 'not-authorised' ? 'not-authorised' : 'unknown';
    return { state, chartVersion: null, mapping: null };
  }
  const chart = parseUmbrellaChart(result.data.text);
  if (!chart) return { state: 'invalid', chartVersion: null, mapping: null };
  return {
    state: 'ok',
    chartVersion: chart.version,
    mapping: mapChartToComponents(raw.config, chart),
  };
}

/** Umbrella chart facts for the snapshot; everything empty when the project has no umbrellaChart. */
export function umbrellaModel(ctx: BuildContext, raw: RawProjectData): UmbrellaModel {
  const config = raw.config.coordinator.umbrellaChart;
  if (!config) return { summary: null, components: new Map(), environments: new Map() };
  const repository = raw.config.coordinator.repository;
  const data = raw.umbrella;
  const main = data ? readChart(raw, data.main) : null;
  const release = data?.release ? readChart(raw, data.release.file) : null;

  // Collection errors: once per classification (a missing environment tag is a real problem).
  const results: ProviderResult<FileDTO>[] = [];
  if (data) {
    results.push(data.main);
    if (data.release) results.push(data.release.file);
    for (const read of data.environments.values()) if (read !== 'skipped') results.push(read.file);
  }
  for (const result of results) {
    if (result.ok) continue;
    const seen = ctx.errors.some(
      (e) =>
        e.repository === repository &&
        e.source === 'umbrella-chart' &&
        e.classification === result.error.classification,
    );
    if (!seen) recordError(ctx, repository, undefined, 'umbrella-chart', result);
  }

  const summary: UmbrellaChartSummary = {
    path: scrubIdentifier(config.path, 255) ?? config.path,
    state: main?.state ?? 'unknown',
    chartVersion: main?.chartVersion ?? null,
    unmapped: main?.mapping?.unmapped ?? [],
    aliases: main?.mapping?.aliases ?? [],
  };

  const components = new Map<string, ComponentUmbrella>();
  for (const comp of raw.config.components) {
    const inMain = main?.mapping?.byComponent.get(comp.id);
    const inRelease = release?.mapping?.byComponent.get(comp.id);
    components.set(comp.id, {
      inUmbrella: Boolean(inMain),
      main: inMain?.version ?? null,
      release: inRelease?.version ?? null,
      conflict: Boolean(inMain?.conflict || inRelease?.conflict),
    });
  }

  const environments = new Map<string, EnvironmentComponentVersions>();
  if (data) {
    const skipped = [...data.environments.values()].some((r) => r === 'skipped');
    const refs = skipped
      ? environmentVersionRefs(raw, config.tagPrefix)
      : new Map<string, string>();
    for (const [id, read] of data.environments) {
      if (read === 'skipped') {
        environments.set(id, { ref: refs.get(id) ?? '', state: 'skipped', versions: [] });
        continue;
      }
      const chart = readChart(raw, read.file);
      environments.set(id, {
        ref: read.ref,
        state: chart.state,
        versions: chart.mapping
          ? [...chart.mapping.byComponent].map(([componentId, v]) => ({
              componentId,
              version: v.version,
              conflict: v.conflict,
            }))
          : [],
      });
    }
  }
  return { summary, components, environments };
}
