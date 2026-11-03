import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { METRIC_FAMILIES } from '../../collector/src/outputs/prometheus';

/*
 * examples/grafana/engineering-project-hub.json (spec §5.4): imports into any Grafana with a
 * Prometheus data source. The data source is chosen through the DS_PROMETHEUS variable, never a
 * hard-coded UID, and every query uses only metrics the collector emits.
 */
type Json = Record<string, unknown>;
const dash = JSON.parse(
  readFileSync('examples/grafana/engineering-project-hub.json', 'utf8'),
) as Json & {
  panels: (Json & { datasource: unknown; targets: (Json & { expr: string })[] })[];
  templating: { list: Json[] };
};
const DS = { type: 'prometheus', uid: '${DS_PROMETHEUS}' };

describe('Grafana dashboard', () => {
  it('has the fixed identity and ten panels', () => {
    expect(dash).toMatchObject({
      title: 'Engineering Project Hub',
      uid: 'engineering-project-hub',
      id: null,
      tags: ['engineering-hub'],
    });
    expect(dash).not.toHaveProperty('version');
    expect(dash).not.toHaveProperty('__inputs');
    expect(dash.panels).toHaveLength(10);
  });

  it('chooses the data source through DS_PROMETHEUS and filters by project', () => {
    const ds = dash.templating.list.find((v) => v.name === 'DS_PROMETHEUS');
    expect(ds).toMatchObject({ type: 'datasource', query: 'prometheus' });
    const project = dash.templating.list.find((v) => v.name === 'project');
    expect(project).toMatchObject({ type: 'query', multi: true, includeAll: true });
    expect(project?.datasource).toEqual(DS);
  });

  it('every panel and target uses the variable, and no other UID appears', () => {
    for (const p of dash.panels) {
      expect(p.datasource).toEqual(DS);
      expect(p.targets.length).toBeGreaterThan(0);
      for (const t of p.targets) expect(t.datasource).toEqual(DS);
    }
    const uids = [...JSON.stringify(dash).matchAll(/"uid":"([^"]*)"/g)].map((m) => m[1]);
    expect(new Set(uids)).toEqual(new Set(['engineering-project-hub', '${DS_PROMETHEUS}']));
  });

  it('the overdue total says how many projects are not measured', () => {
    const panel = dash.panels.find((p) => /overdue/i.test(String(p.title)))!;
    const exprs = panel.targets.map((t) => t.expr);
    expect(
      exprs.some((e) =>
        /hub_project_measure_known\{[^}]*measure="overdue_alerts"[^}]*\} == 0/.test(e),
      ),
    ).toBe(true);
  });

  it('queries only metrics the collector emits', () => {
    const used = dash.panels.flatMap((p) =>
      p.targets.flatMap((t) => [...t.expr.matchAll(/\bhub_[a-z_]+/g)].map((m) => m[0])),
    );
    expect(used.length).toBeGreaterThan(0);
    for (const m of used) expect(METRIC_FAMILIES, m).toContain(m);
  });
});
