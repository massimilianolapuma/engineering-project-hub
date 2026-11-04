import type { ChangesFile, NotificationsConfig, PortfolioIndex } from '@model/index';

/*
 * D8: two independent opt-ins (config and repository variable) and real, compared data. The
 * first condition that fails is named, so the summary says why a run stayed dry-run.
 */
export type DryRunReason =
  'mode-config' | 'mode-variable' | 'mock-data' | 'not-compared' | 'synthetic';
export type Mode = { mode: 'send' } | { mode: 'dry-run'; reason: DryRunReason };

export function resolveMode(o: {
  configMode: NotificationsConfig['mode'];
  variable: string | undefined;
  envSource: string | undefined;
  index: PortfolioIndex;
  changes: ChangesFile;
}): Mode {
  if (o.configMode !== 'send') return { mode: 'dry-run', reason: 'mode-config' };
  if (o.variable !== 'send') return { mode: 'dry-run', reason: 'mode-variable' };
  if (o.envSource !== 'github' || o.index.run.dataSource !== 'github')
    return { mode: 'dry-run', reason: 'mock-data' };
  if (o.changes.basis.state !== 'compared') return { mode: 'dry-run', reason: 'not-compared' };
  if (o.changes.basis.synthetic) return { mode: 'dry-run', reason: 'synthetic' };
  return { mode: 'send' };
}
