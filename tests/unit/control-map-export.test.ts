import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PortfolioIndexSchema } from '@model/index';
import { toCsv } from '../../src/lib/csv';
import { CONTROL_MAP_HEADERS, controlMapRows } from '../../src/lib/exports';
import { validatePortfolio, validateProject } from '../../src/lib/validate';
import type { SiteData } from '../../src/lib/data';
import { METRIC_FAMILIES, renderMetrics } from '../../collector/src/outputs/prometheus';

/*
 * Control map outputs (spec §5.5–§5.6): CSV one row per project × check, Prometheus series only
 * for measured levels, never a compliance claim.
 */
const dir = 'fixtures/snapshots';
const text = (f: string) => readFileSync(join(dir, f), 'utf8');
function golden(): SiteData {
  const index = validatePortfolio(text('index.json'));
  if (!index.ok) throw new Error('index');
  const projects = index.data.projects.map((p) => {
    const r = validateProject(text(`projects/${p.id}.json`));
    if (!r.ok) throw new Error(p.id);
    return r.data;
  });
  return { index: index.data, projects };
}

describe('control map CSV', () => {
  it('has its header and one row per project and check', () => {
    expect(CONTROL_MAP_HEADERS).toEqual([
      'project_id',
      'business_unit',
      'check',
      'area',
      'level',
      'state',
      'value',
      'unit',
      'readable',
      'reason',
      'source_environment',
      'signal',
      'collected_at',
    ]);
    const d = golden();
    const rows = controlMapRows(d);
    expect(rows).toHaveLength(d.projects.length * 25);
    for (const r of rows) expect(r).toHaveLength(CONTROL_MAP_HEADERS.length);
    const csv = toCsv(CONTROL_MAP_HEADERS, rows).toLowerCase();
    expect(csv).not.toMatch(/compliant|conforme|conformit/);
  });

  it('writes nothing but the header when the map is off', () => {
    const d = golden();
    const off: SiteData = { ...d, projects: d.projects.map((p) => ({ ...p, controlMap: null })) };
    expect(controlMapRows(off)).toEqual([]);
  });
});

describe('control map metrics', () => {
  const index = () => PortfolioIndexSchema.parse(JSON.parse(text('index.json')));
  const DEFAULTS = { enabled: true, maxBytes: 4_194_304 };

  it('emits score, measured and one level series per measured check', () => {
    const out = renderMetrics(index(), DEFAULTS).text.split('\n');
    expect(METRIC_FAMILIES).toContain('hub_project_control_score');
    expect(METRIC_FAMILIES).toContain('hub_project_control_level');
    expect(METRIC_FAMILIES).toContain('hub_project_control_measured');
    const alpha = index().projects.find((p) => p.id === 'project-alpha')!;
    const measuredLevels = Object.values(alpha.controlMap!.levels).filter(
      (l) => typeof l === 'number',
    ).length;
    expect(
      out.filter(
        (l) => l.startsWith('hub_project_control_level{') && l.includes('project="project-alpha"'),
      ),
    ).toHaveLength(measuredLevels);
    expect(out).toContain(
      `hub_project_control_measured{project="project-alpha"} ${alpha.controlMap!.measured}`,
    );
    const help = out
      .filter((l) => l.startsWith('# HELP hub_project_control'))
      .join(' ')
      .toLowerCase();
    expect(help).not.toContain('compliant');
  });

  it('emits no control series when the map is off', () => {
    const i = index();
    const off = { ...i, projects: i.projects.map((p) => ({ ...p, controlMap: null })) };
    const out = renderMetrics(off, DEFAULTS).text.split('\n');
    expect(out.some((l) => /^hub_project_control_/.test(l))).toBe(false);
  });
});
