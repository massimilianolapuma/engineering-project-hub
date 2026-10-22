/**
 * Validates policies and exceptions, runs the decision cases and (optionally) re-evaluates an
 * existing snapshot directory, read-only. Usage: npm run policy:check -- [flags]
 * Exit codes: 0 valid, 1 a validation error / failed case / warning with --fail-on-warnings,
 * 2 usage error.
 */
import { parseArgs } from 'node:util';
import { runPolicyCheck } from '../collector/src/policy/check';

const USAGE = `Usage: npm run policy:check -- [--config <dir>] [--exceptions <file>] [--cases <dir>]
       [--snapshot <dir>] [--now <iso>] [--fail-on-warnings] [--allow-date-tokens]`;

let values;
try {
  ({ values } = parseArgs({
    options: {
      config: { type: 'string', default: 'config' },
      exceptions: { type: 'string' },
      cases: { type: 'string' },
      snapshot: { type: 'string' },
      now: { type: 'string' },
      'fail-on-warnings': { type: 'boolean', default: false },
      'allow-date-tokens': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  }));
} catch (e) {
  console.error(`${(e as Error).message}\n${USAGE}`);
  process.exit(2);
}

const now = values.now ? new Date(values.now) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error(`Invalid --now value: ${values.now}\n${USAGE}`);
  process.exit(2);
}

const result = await runPolicyCheck({
  configDir: values.config,
  exceptionsFile: values.exceptions,
  casesDir: values.cases,
  snapshotDir: values.snapshot,
  now,
  failOnWarnings: values['fail-on-warnings'],
  allowDateTokens: values['allow-date-tokens'],
});
for (const line of result.lines) console.log(line);
process.exit(result.exitCode);
