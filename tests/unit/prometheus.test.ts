import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PortfolioIndexSchema, type PortfolioIndex } from '@model/index';
import { METRIC_FAMILIES, renderMetrics } from '../../collector/src/outputs/prometheus';

/*
 * Prometheus text format 0.0.4 from index.json (spec §5.3). Gauges only, no timestamps, no
 * repository / component / team label; an unknown value is an omitted series plus
 * hub_project_measure_known 0, never a 0.
 */
const golden = (): PortfolioIndex =>
  PortfolioIndexSchema.parse(JSON.parse(readFileSync('fixtures/snapshots/index.json', 'utf8')));
const DEFAULTS = { enabled: true, maxBytes: 4_194_304 };
const lines = (text: string) => text.split('\n');

describe('renderMetrics on the golden index', () => {
  const out = renderMetrics(golden(), DEFAULTS);
  const text = out.text;

  it('follows the text format: HELP then TYPE once per family, samples after their TYPE', () => {
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('\r');
    const ls = lines(text);
    const helps = ls.filter((l) => l.startsWith('# HELP '));
    const names = helps.map((l) => l.split(' ')[2]);
    expect(new Set(names).size).toBe(names.length);
    ls.forEach((l, i) => {
      if (l.startsWith('# HELP ')) expect(ls[i + 1]).toBe(`# TYPE ${l.split(' ')[2]} gauge`);
    });
    let current = '';
    for (const l of ls) {
      if (l.startsWith('# TYPE ')) current = l.split(' ')[2]!;
      else if (l && !l.startsWith('#')) expect(l.split(/[{ ]/)[0]).toBe(current);
    }
    expect(out.bytes).toBe(Buffer.byteLength(text, 'utf8'));
    expect(out.series).toBe(ls.filter((l) => l && !l.startsWith('#')).length);
    expect(out.truncated).toBe('none');
  });

  it('publishes the portfolio counts', () => {
    for (const l of [
      'hub_collection_timestamp_seconds 1768478400',
      'hub_projects 4',
      'hub_portfolio_projects{status="red"} 2',
      'hub_portfolio_projects{status="amber"} 1',
      'hub_portfolio_projects{status="green"} 0',
      'hub_portfolio_projects{status="grey"} 1',
      'hub_metrics_truncated 0',
    ])
      expect(lines(text)).toContain(l);
  });

  it('omits an unknown score and says so in measure_known', () => {
    expect(lines(text)).toContain('hub_project_score{project="project-beta"} 40');
    expect(text).not.toMatch(/hub_project_score\{project="project-gamma"\}/);
    expect(lines(text)).toContain(
      'hub_project_measure_known{measure="score",project="project-gamma"} 0',
    );
    expect(lines(text)).toContain(
      'hub_project_measure_known{measure="score",project="project-beta"} 1',
    );
  });

  it('publishes known open counts and marks incomplete or unknown ones', () => {
    expect(lines(text)).toContain(
      'hub_project_open_alerts{project="project-beta",severity="critical"} 1',
    );
    expect(lines(text)).toContain('hub_project_open_alerts_complete{project="project-beta"} 0');
    expect(text).not.toContain('hub_project_open_alerts{project="project-gamma"');
    expect(lines(text)).toContain(
      'hub_project_measure_known{measure="open_alerts",project="project-gamma"} 0',
    );
  });

  it('publishes overdue and supply-chain counts, omitting nulls', () => {
    for (const l of [
      'hub_project_overdue_alerts{class="critical_high",project="platform"} 1',
      'hub_project_unsigned_images{project="project-beta"} 1',
      'hub_project_flagged_licenses{project="platform"} 2',
    ])
      expect(lines(text)).toContain(l);
    expect(text).not.toContain('hub_project_flagged_licenses{project="project-beta"');
    expect(text).not.toContain('hub_project_unsigned_images{project="project-gamma"');
    expect(lines(text)).toContain(
      'hub_project_measure_known{measure="unsigned_images",project="project-gamma"} 0',
    );
  });

  it('publishes ratios between 0 and 1', () => {
    expect(lines(text)).toContain(
      'hub_project_repository_controls_ratio{project="project-beta"} 0.42',
    );
    expect(lines(text)).toContain(
      'hub_project_quality_coverage_ratio{project="project-alpha"} 0.847',
    );
  });

  it('one-hot statuses and provider states', () => {
    for (const id of ['platform', 'project-alpha', 'project-beta', 'project-gamma']) {
      const on = lines(text).filter(
        (l) => l.startsWith(`hub_project_status{project="${id}",`) && l.endsWith(' 1'),
      );
      expect(on).toHaveLength(1);
    }
    expect(lines(text)).toContain('hub_project_status{project="project-gamma",status="grey"} 1');
    const sonar = lines(text).filter((l) =>
      l.startsWith('hub_provider_state{provider="sonarqube"'),
    );
    expect(sonar).toHaveLength(5);
    expect(sonar.filter((l) => l.endsWith(' 1'))).toEqual([
      'hub_provider_state{provider="sonarqube",state="partial"} 1',
    ]);
    expect(
      lines(text).filter(
        (l) => l.startsWith('hub_project_dimension_status{') && l.includes('project="platform"'),
      ),
    ).toHaveLength(24);
  });

  it('never carries repository, component or team data', () => {
    for (const l of lines(text).filter((x) => !x.startsWith('#'))) {
      expect(l).not.toContain('example-org');
      expect(l).not.toContain('github.com');
      expect(l).not.toContain('team');
      expect(l).not.toContain('repository=');
      expect(l).not.toContain('component=');
    }
  });

  it('is deterministic', () => {
    expect(renderMetrics(golden(), DEFAULTS).text).toBe(text);
  });
});

describe('renderMetrics edge cases', () => {
  it('escapes label values (defence in depth)', () => {
    const idx = golden();
    idx.projects[0]!.id = 'a"b\\c';
    expect(renderMetrics(idx, DEFAULTS).text).toContain('hub_project_score{project="a\\"b\\\\c"}');
  });

  it('drops per-dimension statuses first, then every per-project series', () => {
    const full = renderMetrics(golden(), DEFAULTS);
    const dims = renderMetrics(golden(), { enabled: true, maxBytes: full.bytes - 1 });
    expect(dims.truncated).toBe('dimensions');
    expect(dims.text).not.toContain('hub_project_dimension_status{');
    expect(lines(dims.text)).toContain('hub_metrics_truncated 1');
    expect(dims.text).toContain('hub_project_score{');

    const tiny = renderMetrics(golden(), { enabled: true, maxBytes: 200 });
    expect(tiny.truncated).toBe('portfolio-only');
    expect(lines(tiny.text).some((l) => /^hub_project_/.test(l))).toBe(false);
    expect(lines(tiny.text)).toContain('hub_metrics_truncated 1');
    expect(lines(tiny.text)).toContain('hub_projects 4');
  });

  it('lists the 29 families in emission order', () => {
    expect(METRIC_FAMILIES).toHaveLength(29);
    expect(METRIC_FAMILIES[0]).toBe('hub_info');
    expect(METRIC_FAMILIES.at(-1)).toBe('hub_metrics_truncated');
    const text = renderMetrics(golden(), DEFAULTS).text;
    const order = lines(text)
      .filter((l) => l.startsWith('# HELP '))
      .map((l) => l.split(' ')[2]);
    expect(order).toEqual([...METRIC_FAMILIES]);
  });
});
