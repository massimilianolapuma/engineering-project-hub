/**
 * npm run notify -- --snapshots <dir> --config <configDir> --out <dir> [--ledger <file>]
 * Runs only in the notify job (ADR 0013). Prints the summary; never a URL, header or secret.
 */
import { parseArgs } from 'node:util';
import { runNotifier } from './run';

const { values } = parseArgs({
  options: {
    snapshots: { type: 'string', default: 'public/data' },
    config: { type: 'string', default: 'config' },
    out: { type: 'string', default: 'notify-out' },
    ledger: { type: 'string' },
  },
});

runNotifier({
  snapshots: values.snapshots,
  config: values.config,
  out: values.out,
  ledger: values.ledger,
  env: process.env,
  now: () => new Date(),
})
  .then((r) => {
    console.log(r.summary);
    process.exit(r.exitCode);
  })
  .catch(() => {
    // Fixed message: an unexpected error must not print request details.
    console.error('✖ notifier failed unexpectedly');
    process.exit(1);
  });
