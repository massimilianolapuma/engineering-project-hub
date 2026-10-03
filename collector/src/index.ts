#!/usr/bin/env node
/**
 * Engineering Project Hub collector CLI.
 *
 *   tsx collector/src/index.ts [--source mock|github] [--out public/data] [--config config]
 *                              [--fixtures fixtures/github] [--now 2026-01-15T12:00:00Z]
 *
 * --source defaults to $DATA_SOURCE, then "mock". Exit codes: 0 ok (individual repository
 * errors are data, not failures), 1 structural error (config, auth, schema, sanitisation).
 */
import { parseArgs } from 'node:util';
import { DataSourceSchema } from '@model/index';
import { ConfigError, loadConfig } from './config/load';
import { AuthConfigError, resolveAuth } from './providers/auth';
import { createGitHubClient, GitHubProvider } from './providers/github/github-provider';
import { MockProvider } from './providers/mock/mock-provider';
import type { SourceProvider } from './providers/types';
import { runCollection } from './run';
import { SanitizationError } from './sanitizers/sanitize';
import { fixedClock, systemClock } from './util/clock';
import { SnapshotValidationError, writeSnapshots } from './writers/write-snapshots';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      out: { type: 'string', default: 'public/data' },
      config: { type: 'string', default: 'config' },
      fixtures: { type: 'string', default: 'fixtures/github' },
      now: { type: 'string' },
      'api-url': { type: 'string' },
    },
  });
  const sourceParse = DataSourceSchema.safeParse(
    values.source ?? process.env.DATA_SOURCE ?? 'mock',
  );
  if (!sourceParse.success) {
    console.error(
      `Invalid data source "${values.source ?? process.env.DATA_SOURCE}". Use "mock" or "github".`,
    );
    return 1;
  }
  const source = sourceParse.data;
  const clock = values.now ? fixedClock(values.now) : systemClock;

  const { catalog, policies } = await loadConfig(values.config);
  const auth = resolveAuth(source);
  const provider: SourceProvider =
    auth.mode === 'mock'
      ? new MockProvider(values.fixtures, clock)
      : new GitHubProvider(
          createGitHubClient(auth, { baseUrl: values['api-url'] ?? process.env.GITHUB_API_URL }),
          auth.mode,
        );

  console.log(
    `Collecting ${catalog.projects.length} project(s) · source=${source} · auth=${provider.authenticationMode}`,
  );
  const result = await runCollection({ catalog, policies, provider, clock });
  const report = await writeSnapshots(
    values.out,
    result.index,
    result.projects,
    catalog,
    result.discovery,
  );

  for (const p of result.index.projects)
    console.log(
      `  ${p.id.padEnd(24)} overall=${p.overall.padEnd(5)} errors=${p.collectionErrorCount}`,
    );
  const r = report.repositories;
  console.log(
    `Repositories: ${r.total} total · ${r.ok} ok · ${r.withErrors} with errors · ${r.unavailable} unavailable`,
  );
  console.log(`Snapshots written to ${values.out}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    if (
      e instanceof ConfigError ||
      e instanceof AuthConfigError ||
      e instanceof SnapshotValidationError ||
      e instanceof SanitizationError
    ) {
      console.error(`✖ ${e.message}`);
    } else {
      // Never print the error object: it may embed request options.
      console.error(
        `✖ Collector failed: ${(e as Error)?.name ?? 'Error'}: ${String((e as Error)?.message ?? '')
          .split('\n')[0]
          ?.slice(0, 200)}`,
      );
    }
    process.exit(1);
  });
