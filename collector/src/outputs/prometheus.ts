import {
  DimensionSchema,
  HealthStatusSchema,
  ProviderStateSchema,
  type Policies,
  type PortfolioIndex,
} from '@model/index';

/*
 * Prometheus text format 0.0.4 (spec §5.3), rendered from index.json only. Gauges, no sample
 * timestamps (the node_exporter textfile collector refuses them), no repository, component,
 * team or URL label in any audience. An unknown value is an omitted series plus
 * hub_project_measure_known 0: a missing series is never to be read as 0.
 */

export type MetricsTruncation = 'none' | 'dimensions' | 'portfolio-only';

export interface RenderedMetrics {
  text: string;
  /** Sample lines (comments excluded). */
  series: number;
  /** UTF-8 length of `text`. */
  bytes: number;
  truncated: MetricsTruncation;
}

type Project = PortfolioIndex['projects'][number];
type Labels = Record<string, string>;
interface Sample {
  labels: Labels;
  value: number;
}
interface Family {
  name: string;
  help: string;
  /** Kept when the file is cut down to portfolio-level metrics. */
  portfolio: boolean;
  samples: (index: PortfolioIndex, truncated: number) => Sample[];
}

const STATUSES = HealthStatusSchema.options;
const DIMENSIONS = DimensionSchema.options;
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

const one = (value: number, labels: Labels = {}): Sample[] => [{ labels, value }];
const perProject = (
  index: PortfolioIndex,
  value: (p: Project) => number | null,
  labels: (p: Project) => Labels = () => ({}),
): Sample[] =>
  index.projects.flatMap((p) => {
    const v = value(p);
    return v === null ? [] : [{ labels: { project: p.id, ...labels(p) }, value: v }];
  });
const oneHot = (current: string, options: readonly string[], key: string, base: Labels) =>
  options.map((o) => ({ labels: { ...base, [key]: o }, value: o === current ? 1 : 0 }));
const ratio = (v: number | null) => (v === null ? null : v / 100);
const dimensionStatus = (p: Project, d: (typeof DIMENSIONS)[number]) => {
  const v = p[d];
  return typeof v === 'string' ? v : v.status;
};
const openKnown = (p: Project) => SEVERITIES.every((s) => p.openCounts[s] !== null);

/** measure name → value used to decide whether it was known. */
const MEASURES: [string, (p: Project) => unknown][] = [
  ['score', (p) => p.score.value],
  ['open_alerts', (p) => (openKnown(p) ? 1 : null)],
  ['overdue_alerts', (p) => p.risk.overdue],
  ['controls_coverage', (p) => p.coverage.percentage],
  ['quality_coverage', (p) => p.quality.percentage],
  ['sbom', (p) => p.supplyChain.sbomAvailable],
  ['unsigned_images', (p) => p.supplyChain.unsignedImages],
  ['flagged_licenses', (p) => p.supplyChain.flagged],
];

/** Every family, in emission order (the order of the spec §5.3.2 table). */
const FAMILIES: Family[] = [
  {
    name: 'hub_info',
    help: 'Engineering Project Hub collection metadata; always 1.',
    portfolio: true,
    samples: (i) =>
      one(1, {
        collector_version: i.run.collectorVersion,
        data_source: i.run.dataSource,
        schema_version: i.schemaVersion,
      }),
  },
  {
    name: 'hub_collection_timestamp_seconds',
    help: 'When the data was collected, as Unix seconds.',
    portfolio: true,
    samples: (i) => one(Date.parse(i.generatedAt) / 1000),
  },
  {
    name: 'hub_collection_duration_seconds',
    help: 'Duration of the last collection in seconds.',
    portfolio: true,
    samples: (i) => one(i.run.durationMs / 1000),
  },
  {
    name: 'hub_projects',
    help: 'Number of projects in the catalog.',
    portfolio: true,
    samples: (i) => one(i.projects.length),
  },
  {
    name: 'hub_portfolio_projects',
    help: 'Projects per overall status (grey = not visible, a state, not a zero).',
    portfolio: true,
    samples: (i) =>
      STATUSES.map((s) => ({
        labels: { status: s },
        value: i.projects.filter((p) => p.overall === s).length,
      })),
  },
  {
    name: 'hub_project_status',
    help: 'Overall project status, one-hot over green, amber, red, grey.',
    portfolio: false,
    samples: (i) =>
      i.projects.flatMap((p) => oneHot(p.overall, STATUSES, 'status', { project: p.id })),
  },
  {
    name: 'hub_project_dimension_status',
    help: 'Status per dimension, one-hot over green, amber, red, grey; "coverage" means security controls coverage.',
    portfolio: false,
    samples: (i) =>
      i.projects.flatMap((p) =>
        DIMENSIONS.flatMap((d) =>
          oneHot(dimensionStatus(p, d), STATUSES, 'status', { dimension: d, project: p.id }),
        ),
      ),
  },
  {
    name: 'hub_project_score',
    help: 'Project score 0-100; series absent when the score could not be measured (see hub_project_measure_known).',
    portfolio: false,
    samples: (i) => perProject(i, (p) => p.score.value),
  },
  {
    name: 'hub_project_open_alerts',
    help: 'Open security alerts per severity; a severity whose count is unknown has no series.',
    portfolio: false,
    samples: (i) =>
      i.projects.flatMap((p) =>
        SEVERITIES.flatMap((s) => {
          const v = p.openCounts[s];
          return v === null ? [] : [{ labels: { project: p.id, severity: s }, value: v }];
        }),
      ),
  },
  {
    name: 'hub_project_open_alerts_complete',
    help: '1 when the open alert counts are complete, 0 when they are a lower bound.',
    portfolio: false,
    samples: (i) => perProject(i, (p) => (p.countsComplete ? 1 : 0)),
  },
  {
    name: 'hub_project_overdue_alerts',
    help: 'Open alerts past their remediation deadline (class "all" or "critical_high"); absent when not measured.',
    portfolio: false,
    samples: (i) => [
      ...perProject(
        i,
        (p) => p.risk.overdue,
        () => ({ class: 'all' }),
      ),
      ...perProject(
        i,
        (p) => p.risk.overdueCriticalHigh,
        () => ({ class: 'critical_high' }),
      ),
    ],
  },
  {
    name: 'hub_project_accepted_alerts',
    help: 'Open alerts accepted under a valid security exception; absent when not measured.',
    portfolio: false,
    samples: (i) => perProject(i, (p) => p.risk.accepted),
  },
  {
    name: 'hub_project_exception_issues',
    help: 'Security exceptions that are expired, stale, unverifiable or invalid.',
    portfolio: false,
    samples: (i) => perProject(i, (p) => p.risk.exceptionIssues),
  },
  {
    name: 'hub_project_repository_controls_ratio',
    help: 'Share of repository controls passed (0-1); absent when not measured.',
    portfolio: false,
    samples: (i) => perProject(i, (p) => ratio(p.repositoryControls.ratio)),
  },
  {
    name: 'hub_project_supply_chain_repositories',
    help: 'Repositories considered for supply-chain evidence; absent when unknown.',
    portfolio: false,
    samples: (i) => perProject(i, (p) => p.supplyChain.repositories),
  },
  {
    name: 'hub_project_sbom_available',
    help: 'Repositories with a readable SBOM; absent when unknown.',
    portfolio: false,
    samples: (i) => perProject(i, (p) => p.supplyChain.sbomAvailable),
  },
  {
    name: 'hub_project_unsigned_images',
    help: 'Distinct container images (by digest) without a verified signature; absent when unknown.',
    portfolio: false,
    samples: (i) => perProject(i, (p) => p.supplyChain.unsignedImages),
  },
  {
    name: 'hub_project_flagged_licenses',
    help: 'Packages with a flagged license; absent when unknown.',
    portfolio: false,
    samples: (i) => perProject(i, (p) => p.supplyChain.flagged),
  },
  {
    name: 'hub_provider_enabled',
    help: '1 when the optional provider is enabled in providers.yaml.',
    portfolio: true,
    samples: (i) =>
      Object.entries(i.run.providers).map(([id, p]) => ({
        labels: { provider: id },
        value: p.enabled ? 1 : 0,
      })),
  },
  {
    name: 'hub_provider_state',
    help: 'Optional provider state, one-hot over off, available, partial, not-authorised, unknown.',
    portfolio: true,
    samples: (i) =>
      Object.entries(i.run.providers).flatMap(([id, p]) =>
        oneHot(p.state, ProviderStateSchema.options, 'state', { provider: id }),
      ),
  },
  {
    name: 'hub_project_controls_coverage_ratio',
    help: 'Required security controls available (0-1); absent when not measured.',
    portfolio: false,
    samples: (i) => perProject(i, (p) => ratio(p.coverage.percentage)),
  },
  {
    name: 'hub_project_quality_coverage_ratio',
    help: 'Test line coverage (0-1); absent when not measured.',
    portfolio: false,
    samples: (i) => perProject(i, (p) => ratio(p.quality.percentage)),
  },
  {
    name: 'hub_project_collection_errors',
    help: 'Data sources that could not be read in the last collection.',
    portfolio: false,
    samples: (i) => perProject(i, (p) => p.collectionErrorCount),
  },
  {
    name: 'hub_project_measure_known',
    help: '1 when the measure was known in the last collection, 0 when it was not (never read a missing series as 0).',
    portfolio: false,
    samples: (i) =>
      i.projects.flatMap((p) =>
        MEASURES.map(([measure, get]) => ({
          labels: { measure, project: p.id },
          value: get(p) === null ? 0 : 1,
        })),
      ),
  },
  {
    name: 'hub_project_control_score',
    help: 'Control map score 0-100 (technical checks related to DORA and ISO 27001, not an assessment of either); absent when not measured or not published.',
    portfolio: false,
    samples: (i) => perProject(i, (p) => p.controlMap?.score ?? null),
  },
  {
    name: 'hub_project_control_measured',
    help: 'Control map checks measured, out of hub_project_control_applicable.',
    portfolio: false,
    samples: (i) => perProject(i, (p) => p.controlMap?.measured ?? null),
  },
  {
    name: 'hub_project_control_applicable',
    help: 'Control map checks that apply to the project.',
    portfolio: false,
    samples: (i) => perProject(i, (p) => p.controlMap?.applicable ?? null),
  },
  {
    name: 'hub_project_control_level',
    help: 'Control map level 0-5 per check; a check not measured or not applicable has no series.',
    portfolio: false,
    samples: (i) =>
      i.projects.flatMap((p) =>
        Object.entries(p.controlMap?.levels ?? {}).flatMap(([check, level]) =>
          typeof level === 'number' ? [{ labels: { check, project: p.id }, value: level }] : [],
        ),
      ),
  },
  {
    name: 'hub_metrics_truncated',
    help: '1 when the file was cut down to stay under outputs.metrics.maxBytes, else 0.',
    portfolio: true,
    samples: (_i, truncated) => one(truncated),
  },
];

export const METRIC_FAMILIES: readonly string[] = FAMILIES.map((f) => f.name);

const escapeLabel = (v: string) =>
  v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const labelText = (labels: Labels) => {
  const keys = Object.keys(labels).sort();
  return keys.length ? `{${keys.map((k) => `${k}="${escapeLabel(labels[k]!)}"`).join(',')}}` : '';
};

function render(index: PortfolioIndex, families: Family[], truncated: number) {
  const out: string[] = [];
  let series = 0;
  for (const f of families) {
    out.push(`# HELP ${f.name} ${f.help}`, `# TYPE ${f.name} gauge`);
    const samples = f
      .samples(index, truncated)
      .map((s) => `${f.name}${labelText(s.labels)} ${String(s.value)}`)
      .sort();
    series += samples.length;
    out.push(...samples);
  }
  const text = `${out.join('\n')}\n`;
  return { text, series, bytes: Buffer.byteLength(text, 'utf8') };
}

/**
 * Renders the metrics file. Over `maxBytes` it drops hub_project_dimension_status and
 * hub_project_control_level, then every
 * per-project family (spec §5.3.4); it never throws for size.
 */
export function renderMetrics(
  index: PortfolioIndex,
  metrics: Policies['outputs']['metrics'],
): RenderedMetrics {
  const full = render(index, FAMILIES, 0);
  if (full.bytes <= metrics.maxBytes) return { ...full, truncated: 'none' };
  const noDims = render(
    index,
    FAMILIES.filter(
      (f) => f.name !== 'hub_project_dimension_status' && f.name !== 'hub_project_control_level',
    ),
    1,
  );
  if (noDims.bytes <= metrics.maxBytes) return { ...noDims, truncated: 'dimensions' };
  return {
    ...render(
      index,
      FAMILIES.filter((f) => f.portfolio),
      1,
    ),
    truncated: 'portfolio-only',
  };
}
