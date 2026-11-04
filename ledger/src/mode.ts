/*
 * D9 (deployments ledger): two independent opt-ins. The writer posts only when the workflow input
 * `mode` is `write` AND the repository variable HUB_DEPLOYMENTS_BRIDGE is `write`; otherwise it
 * runs dry and the summary names the opt-in that is missing.
 */
export type LedgerMode =
  { mode: 'write' } | { mode: 'dry-run'; reason: 'mode-input' | 'mode-variable' };

export function resolveLedgerMode(o: {
  input: string | undefined;
  variable: string | undefined;
}): LedgerMode {
  if (o.input !== 'write') return { mode: 'dry-run', reason: 'mode-input' };
  if (o.variable !== 'write') return { mode: 'dry-run', reason: 'mode-variable' };
  return { mode: 'write' };
}
