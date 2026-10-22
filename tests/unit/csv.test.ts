import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NA, csvCell, toCsv, type CsvValue } from '../../src/lib/csv';
import {
  FINDINGS_HEADERS,
  PORTFOLIO_HEADERS,
  SUPPLY_CHAIN_HEADERS,
  VERSIONS_HEADERS,
  findingsRows,
  portfolioRows,
  supplyChainRows,
  unavailableCsv,
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
      'controls_passed',
      'controls_failed',
      'controls_unknown',
      'overdue',
      'overdue_critical_high',
      'accepted',
      'exception_issues',
      'teams',
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
      'overdue',
      'accepted',
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
      'environment_source',
      'environment_declared_version',
      'sync_status',
      'health_status',
    ]);
  });

  it('every row has as many cells as headers', () => {
    const d = golden();
    for (const r of portfolioRows(d, history())) expect(r).toHaveLength(PORTFOLIO_HEADERS.length);
    for (const r of findingsRows(d)) expect(r).toHaveLength(FINDINGS_HEADERS.length);
    for (const r of versionsRows(d)) expect(r).toHaveLength(VERSIONS_HEADERS.length);
    for (const r of supplyChainRows(d)) expect(r).toHaveLength(SUPPLY_CHAIN_HEADERS.length);
  });

  it('portfolio CSV carries the repository control counts before the risk columns: beta 5, 7, 8', () => {
    expect(PORTFOLIO_HEADERS.slice(-8, -5)).toEqual([
      'controls_passed',
      'controls_failed',
      'controls_unknown',
    ]);
    const rows = asObjects(PORTFOLIO_HEADERS, portfolioRows(golden(), history()));
    const beta = rows.find((r) => r.project_id === 'project-beta')!;
    expect([beta.controls_passed, beta.controls_failed, beta.controls_unknown]).toEqual([5, 7, 8]);
  });

  it('portfolio CSV ends with teams, joined with ";": alpha pay-project-alpha-dev;platform, gamma empty', () => {
    expect(PORTFOLIO_HEADERS.at(-1)).toBe('teams');
    const rows = asObjects(PORTFOLIO_HEADERS, portfolioRows(golden(), history()));
    expect(rows.find((r) => r.project_id === 'project-alpha')!.teams).toBe(
      'example-org/pay-project-alpha-dev;example-org/platform',
    );
    expect(rows.find((r) => r.project_id === 'project-gamma')!.teams).toBe('');
  });

  it('portfolio CSV has the risk columns before teams: platform 1,1,1,1 and gamma unknown,unknown,unknown,0', () => {
    expect(PORTFOLIO_HEADERS.slice(-5, -1)).toEqual([
      'overdue',
      'overdue_critical_high',
      'accepted',
      'exception_issues',
    ]);
    const csv = toCsv(PORTFOLIO_HEADERS, portfolioRows(golden(), history()))
      .replace('\uFEFF', '')
      .split('\r\n');
    expect(
      csv
        .find((l) => l.startsWith('platform,'))!
        .endsWith(',1,1,1,1,example-org/platform;example-org/security'),
    ).toBe(true);
    expect(
      csv.find((l) => l.startsWith('project-gamma,'))!.endsWith(',unknown,unknown,unknown,0,'),
    ).toBe(true);
  });

  it('findings summary CSV ends with overdue and accepted per repository row', () => {
    expect(FINDINGS_HEADERS.slice(-2)).toEqual(['overdue', 'accepted']);
    const rows = asObjects(FINDINGS_HEADERS, findingsRows(golden()));
    const mono = rows.filter((r) => r.repository === 'example-org/platform-mono');
    expect(mono.length).toBeGreaterThan(0);
    expect(mono.reduce((n, r) => n + Number(r.overdue), 0)).toBeGreaterThanOrEqual(1);
    const gamma = rows.filter((r) => r.project_id === 'project-gamma');
    for (const r of gamma) expect([r.overdue, r.accepted]).toEqual([null, null]);
  });

  it('portfolio control counts are n/a, never 0, when nothing was evaluated', () => {
    const d = golden();
    for (const pr of d.index.projects)
      Object.assign(pr.repositoryControls, { passed: 0, failed: 0, unknown: 0 });
    const rows = asObjects(PORTFOLIO_HEADERS, portfolioRows(d, history()));
    for (const r of rows)
      expect([r.controls_passed, r.controls_failed, r.controls_unknown]).toEqual([NA, NA, NA]);
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

describe('versions and supply chain CSV (schema 1.7)', () => {
  it('versions.csv ends with the Argo CD columns, n/a outside environment rows', () => {
    expect(VERSIONS_HEADERS.slice(-4)).toEqual([
      'environment_source',
      'environment_declared_version',
      'sync_status',
      'health_status',
    ]);
    const rows = asObjects(VERSIONS_HEADERS, versionsRows(golden()));
    const coordinator = rows.find((r) => r.row_type === 'coordinator')!;
    expect([coordinator.environment_source, coordinator.sync_status]).toEqual([NA, NA]);
    const env = (project: string, id: string) =>
      rows.find(
        (r) => r.row_type === 'environment' && r.project_id === project && r.item_id === id,
      )!;
    expect(env('project-alpha', 'uat')).toMatchObject({
      environment_source: 'manifest',
      environment_declared_version: '1.4.0',
      sync_status: 'out-of-sync',
      health_status: 'progressing',
    });
    expect(env('project-alpha', 'dev')).toMatchObject({
      environment_source: 'argocd',
      sync_status: 'synced',
    });
    // Not managed by Argo CD: n/a, not unknown.
    expect(env('project-alpha', 'test')).toMatchObject({
      sync_status: NA,
      health_status: NA,
    });
    // Mapped but not readable: the cells are n/a too (no deployment was read).
    expect(env('project-beta', 'dev').environment_source).toBe('manifest');
  });

  it('supply-chain.csv has one row per project and repository: 12 rows, platform flagged 2', () => {
    const rows = asObjects(SUPPLY_CHAIN_HEADERS, supplyChainRows(golden()));
    expect(rows).toHaveLength(12);
    const platform = rows.find((r) => r.project_id === 'platform')!;
    expect(platform).toMatchObject({ flagged: 2, packages: 1530, sbom_source: 'dependency-graph' });
    expect(platform.container_scanning_source).toBe('code-scanning');
    const worker = rows.find((r) => String(r.repository).endsWith('alpha-worker'))!;
    expect(worker).toMatchObject({
      sbom_state: 'pending',
      packages: null,
      attestation_state: 'unknown',
    });
    const frontend = rows.find((r) => String(r.repository).endsWith('alpha-frontend'))!;
    expect(frontend.sbom_source).toBe('supply-chain-summary');
    expect(frontend.dast_source).toBe('code-scanning');
    expect(rows.find((r) => String(r.repository).endsWith('alpha-backend'))!).toMatchObject({
      images: 2,
      images_signed: 2,
      images_unsigned: 0,
      container_scanning_source: 'harbor',
    });
    const mono = rows.filter((r) => String(r.component_ids).includes(';'));
    expect(mono.length).toBeGreaterThan(0);
  });
});

describe('unavailableCsv', () => {
  it('is never a header-only file that reads as zero projects', () => {
    const lines = unavailableCsv(PORTFOLIO_HEADERS)
      .replace('\uFEFF', '')
      .split('\r\n')
      .filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(PORTFOLIO_HEADERS.join(','));
    expect(lines[1]!.split(',')).toHaveLength(PORTFOLIO_HEADERS.length);
    expect(lines[1]!.startsWith('data unavailable,unknown,')).toBe(true);
  });
});
