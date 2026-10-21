import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PortfolioIndexSchema,
  ProjectSnapshotSchema,
  type Catalog,
  type Policies,
} from '@model/index';
import { loadConfig } from '../../collector/src/config/load';
import { buildHistoryExtras } from '../../collector/src/history/extras';
import { cleanHistory, type PreviousHistory } from '../../collector/src/history/load';
import {
  buildReport,
  reportMarkdown,
  serialise,
} from '../../collector/src/writers/write-snapshots';
import { daysAgo, historyEntry, historyFile, NOW } from '../helpers/factories';

let catalog: Catalog;
let policies: Policies;
beforeAll(async () => {
  ({ catalog, policies } = await loadConfig('config'));
});

const run = () => {
  const index = PortfolioIndexSchema.parse(
    JSON.parse(readFileSync('fixtures/snapshots/index.json', 'utf8')),
  );
  index.generatedAt = NOW.toISOString();
  index.run.dataSource = 'github';
  const projects = index.projects.map((p) =>
    ProjectSnapshotSchema.parse(
      JSON.parse(readFileSync(`fixtures/snapshots/projects/${p.id}.json`, 'utf8')),
    ),
  );
  return { index, projects };
};

describe('buildHistoryExtras', () => {
  it('uses a usable restored history as is', () => {
    const { index, projects } = run();
    const file = cleanHistory(historyFile([historyEntry(daysAgo(1))]), catalog, policies, NOW);
    const extras = buildHistoryExtras(
      { state: 'restored', file },
      index,
      projects,
      catalog,
      policies,
      NOW,
    );
    expect(extras.history?.restore).toEqual({ state: 'restored', previousEntries: 1 });
    expect(extras.notes).toEqual([]);
  });

  it('falls back to a fresh "unreadable" history when the restored one cannot be published', () => {
    const { index, projects } = run();
    // Bypasses loading and cleaning: the defence in depth must still hold.
    const file = cleanHistory(historyFile([historyEntry(daysAgo(1))]), catalog, policies, NOW);
    file.entries[0]!.collectorVersion = 'ghp_exampleSecretValue';
    const previous: PreviousHistory = { state: 'restored', file };
    const extras = buildHistoryExtras(previous, index, projects, catalog, policies, NOW);
    expect(extras.history?.restore).toEqual({ state: 'unreadable', previousEntries: 0 });
    expect(extras.history?.entries).toHaveLength(1);
    expect(extras.changes?.basis.state).toBe('unreadable');
    expect(extras.notes).toHaveLength(1);
    expect(extras.notes?.[0]).toMatch(/restored history could not be used/);
    const text = [...serialise(index, projects, catalog, null, extras).values()].join('\n');
    expect(text).not.toContain('ghp_exampleSecretValue');
    const md = reportMarkdown(buildReport(index, projects, extras.history, extras.notes));
    expect(md).toContain('| History | started fresh (unreadable) · 1 entry |');
    expect(md).toContain('restored history could not be used');
  });

  it('a catalog beyond the history limits writes no history, keeps a note and never throws', () => {
    const { index, projects } = run();
    const s0 = index.projects[0]!;
    index.projects = Array.from({ length: 501 }, (_, n) => ({ ...s0, id: `p${n}` }));
    const extras = buildHistoryExtras(
      { state: 'none', file: null },
      index,
      projects,
      catalog,
      policies,
      NOW,
    );
    expect(extras.history).toBeNull();
    expect(extras.changes).toBeNull();
    expect(extras.notes?.[0]).toMatch(/not written for this run .*entries\[0\]\.projects/);
    const report = buildReport(index, projects, extras.history, extras.notes);
    expect(report.history).toMatchObject({ state: 'not-written', entries: 0 });
    expect(reportMarkdown(report)).toContain('| History | not written this run');
  });

  it('carries the notes of the restored history into the report', () => {
    const { index, projects } = run();
    const file = cleanHistory(historyFile([historyEntry(daysAgo(1))]), catalog, policies, NOW);
    const extras = buildHistoryExtras(
      { state: 'restored', file, notes: ['Dropped 1 earlier collection.'] },
      index,
      projects,
      catalog,
      policies,
      NOW,
    );
    expect(extras.notes).toEqual(['Dropped 1 earlier collection.']);
  });
});
