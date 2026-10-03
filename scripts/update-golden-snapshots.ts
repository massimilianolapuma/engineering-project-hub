/**
 * Regenerates fixtures/snapshots (golden files) from the mock provider with a fixed clock.
 * Run after intentional changes to fixtures, evaluators or the snapshot model:
 *   npm run fixtures:update
 */
import { loadConfig } from '../collector/src/config/load';
import { MockProvider } from '../collector/src/providers/mock/mock-provider';
import { runCollection } from '../collector/src/run';
import { fixedClock } from '../collector/src/util/clock';
import { writeSnapshots } from '../collector/src/writers/write-snapshots';

export const GOLDEN_NOW = '2026-01-15T12:00:00.000Z';

const { catalog, policies } = await loadConfig('config');
const clock = fixedClock(GOLDEN_NOW);
const result = await runCollection({
  catalog,
  policies,
  provider: new MockProvider('fixtures/github', clock),
  clock,
});
await writeSnapshots(
  'fixtures/snapshots',
  result.index,
  result.projects,
  catalog,
  result.discovery,
);
console.log('✔ fixtures/snapshots regenerated');
