/**
 * Regenerates fixtures/snapshots (golden files) from the mock provider with a fixed clock.
 * Run after intentional changes to fixtures, evaluators or the snapshot model:
 *   npm run fixtures:update
 */
import { loadConfig } from '../collector/src/config/load';
import { buildHistoryExtras } from '../collector/src/history/extras';
import { loadPreviousHistory } from '../collector/src/history/load';
import { MockProvider } from '../collector/src/providers/mock/mock-provider';
import { runCollection } from '../collector/src/run';
import { fixedClock } from '../collector/src/util/clock';
import { writeSnapshots } from '../collector/src/writers/write-snapshots';

export const GOLDEN_NOW = '2026-01-15T12:00:00.000Z';

const clock = fixedClock(GOLDEN_NOW);
// The mock source reads the fixture exceptions, whose dates may use @now tokens.
const { catalog, policies, exceptions } = await loadConfig('config', {
  exceptionsFile: 'fixtures/exceptions/exceptions.yaml',
  allowDateTokens: true,
  now: clock(),
});
const result = await runCollection({
  catalog,
  policies,
  provider: new MockProvider('fixtures/github', clock),
  clock,
  exceptions,
});
// Mock history always starts from the fixture, never from the previous golden output, so
// running this twice gives the same files.
const now = new Date(result.index.generatedAt);
const previous = await loadPreviousHistory({
  dataSource: 'mock',
  historyFrom: 'fixtures/snapshots',
  fixturePath: 'fixtures/history/history.json',
  catalog,
  policies,
  now,
});
await writeSnapshots(
  'fixtures/snapshots',
  result.index,
  result.projects,
  catalog,
  result.discovery,
  buildHistoryExtras(previous, result.index, result.projects, catalog, policies, now),
);
console.log('✔ fixtures/snapshots regenerated');
