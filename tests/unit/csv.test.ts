import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NA, csvCell, toCsv, type CsvValue } from '../../src/lib/csv';
import {
  FINDINGS_HEADERS,
  PORTFOLIO_HEADERS,
  VERSIONS_HEADERS,
  findingsRows,
  portfolioRows,
  versionsRows,
} from '../../src/lib/exports';
import { validateHistory, validatePortfolio, validateProject } from '../../src/lib/validate';
import type { SiteData } from '../../src/lib/data';

describe('csvCell', () => {
  it.each<[CsvValue, string]>([
    ['=1+1', "'=1+1"],
    ['+cmd', "'+cmd"],
    ['-rc.1', "'-rc.1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tx', "'\tx"],
    ['\rx', `"'\rx"`],
    ['=HYPERLINK("http://x")', `"'=HYPERLINK(""http://x"")"`],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line\nbreak', '"line\nbreak"'],
    ['Qualità', 'Qualità'],
    [null, 'unknown'],
    [NA, 'n/a'],
    [42, '42'],
    [0, '0'],
    [true, 'true'],
    [false, 'false'],
  ])('%j → %j', (input, out) => expect(csvCell(input)).toBe(out));
});

describe('toCsv', () => {
  it('starts with the BOM, uses \\r\\n between rows and ends with \\r\\n', () => {
    const out = toCsv(
      ['a', 'b'],
      [
        [1, 'x'],
        [2, null],
      ],
    );
    expect(out).toBe('﻿a,b\r\n1,x\r\n2,unknown\r\n');
  });
  it('header-only file', () => expect(toCsv(['a'], [])).toBe('﻿a\r\n'));
});

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
function history() {
  const h = validateHistory(text('history.json'));
  if (!h.ok) throw new Error('history');
  return h.data;
}
type Row = Record<string, CsvValue>;
const asObjects = (headers: readonly string[], rows: CsvValue[][]): Row[] =>
  rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] as CsvValue])));

describe('export rows (golden data)', () => {
  it('headers match the spec lists exactly', () => {
    expect(PORTFOLIO_HEADERS).toEqual([
      'project_id',
      'project_name',
      'business_unit',
      'lifecycle',
      'overall',
      'score',
      'score_measured',
      'score_required',
      'delivery',
      'version',
      'security',
      'controls_coverage',
      'controls_coverage_percent',
      'governance',
      'quality',
      'quality_percent',
      'open_critical',
      'open_high',
      'open_medium',
      'open_low',
      'counts_complete',
      'open_secret_alerts',
      'failed_critical_workflows',
      'collection_errors',
      'collected_at',
      'previous_overall',
      'previous_score',
      'previous_collected_at',
    ]);
    expect(FINDINGS_HEADERS).toEqual([
      'project_id',
      'component_id',
      'repository',
      'open_critical',
      'open_high',
      'open_medium',
      'open_low',
      'open_informational',
      'open_unknown',
      'sources_complete',
    ]);
    expect(VERSIONS_HEADERS).toEqual([
      'row_type',
      'project_id',
      'item_id',
      'item_name',
      'repository',
      'version',
      'version_source',
      'declared_version',
      'latest_release',
      'drift',
      'manifest_consistency',
      'pin_status',
      'environment_status',
    ]);
  });

  it('every row has as many cells as headers', () => {
    const d = golden();
    for (const r of portfolioRows(d, history())) expect(r).toHaveLength(PORTFOLIO_HEADERS.length);
    for (const r of findingsRows(d)) expect(r).toHaveLength(FINDINGS_HEADERS.length);
    for (const r of versionsRows(d)) expect(r).toHaveLength(VERSIONS_HEADERS.length);
  });

  it('portfolioRows on the golden data: gamma unknown score, beta previous values', () => {
    const rows = asObjects(PORTFOLIO_HEADERS, portfolioRows(golden(), history()));
    const gamma = rows.find((r) => r.project_id === 'project-gamma')!;
    expect(gamma.score).toBeNull();
    expect(gamma.previous_score).toBeNull();
    const beta = rows.find((r) => r.project_id === 'project-beta')!;
    expect(beta.previous_score).toBe(58);
    expect(beta.previous_overall).toBe('amber');
    expect(beta.previous_collected_at).toBe('2026-01-14T12:00:00.000Z');
    expect(beta.score).toBe(40);
  });

  it('portfolioRows without history: previous_* are n/a', () => {
    const rows = asObjects(PORTFOLIO_HEADERS, portfolioRows(golden(), null));
    for (const r of rows) {
      expect(r.previous_overall).toBe(NA);
      expect(r.previous_score).toBe(NA);
      expect(r.previous_collected_at).toBe(NA);
    }
  });

  it('a project missing from the previous entry has n/a previous values', () => {
    const h = history();
    const prev = h.entries.at(-2)!;
    const trimmed = {
      ...h,
      entries: [
        ...h.entries.slice(0, -2),
        { ...prev, projects: prev.projects.filter((p) => p.id !== 'project-beta') },
        h.entries.at(-1)!,
      ],
    };
    const rows = asObjects(PORTFOLIO_HEADERS, portfolioRows(golden(), trimmed));
    expect(rows.find((r) => r.project_id === 'project-beta')!.previous_score).toBe(NA);
  });

  it('findingsRows: gamma counts unknown; beta-api open_critical 1 and sources_complete false', () => {
    const rows = asObjects(FINDINGS_HEADERS, findingsRows(golden()));
    for (const r of rows.filter((x) => x.project_id === 'project-gamma')) {
      for (const k of ['open_critical', 'open_high', 'open_medium', 'open_low'])
        expect(r[k]).toBeNull();
    }
    const api = rows.find((r) => r.repository === 'example-org/project-beta-api')!;
    expect(api.open_critical).toBe(1);
    expect(api.sources_complete).toBe(false);
  });

  it('versionsRows: coordinator, component and environment rows; alpha frontend drift', () => {
    const rows = asObjects(VERSIONS_HEADERS, versionsRows(golden()));
    const types = new Set(rows.map((r) => r.row_type));
    expect(types).toEqual(new Set(['coordinator', 'component', 'environment']));
    const fe = rows.find((r) => r.project_id === 'project-alpha' && r.item_id === 'frontend')!;
    expect(fe.version).toBe('2.1.0');
    expect(fe.drift).toBe('drift');
  });
});
