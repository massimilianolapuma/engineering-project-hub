#!/usr/bin/env node
/**
 * Engineering Project Hub collector CLI.
 *
 *   tsx collector/src/index.ts [--source mock|github] [--out public/data] [--config config]
 *                              [--exceptions <file>] [--fixtures fixtures/github] [--now 2026-01-15T12:00:00Z]
 *                              [--history-from <dir>] [--history-fixture <file>] [--fresh-history]
 *
 * --source defaults to $DATA_SOURCE, then "mock". The previous history is read from
 * --history-from, then $HISTORY_FROM, then --out (mock always starts from --history-fixture).
 * Exit codes: 0 ok (individual repository
 * errors are data, not failures), 1 structural error (config, auth, schema, sanitisation).
 */
import { parseArgs } from 'node:util';
import { DataSourceSchema } from '@model/index';
import { ConfigError, loadConfig, resolveExceptionsPath } from './config/load';
import { AuthConfigError, resolveAuth } from './providers/auth';
import { createGitHubClient, GitHubProvider } from './providers/github/github-provider';
import { buildHistoryExtras } from './history/extras';
import { historyDir, loadPreviousHistory } from './history/load';
import { MockProvider } from './providers/mock/mock-provider';
import type { SourceProvider } from './providers/types';
import { runCollection } from './run';
import { SanitizationError } from './sanitizers/sanitize';
import { fixedClock, systemClock } from './util/clock';
import {
  SnapshotValidationError,
  writeSnapshots,
  type HistoryExtras,
} from './writers/write-snapshots';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      out: { type: 'string', default: 'public/data' },
      config: { type: 'string', default: 'config' },
      exceptions: { type: 'string' },
      fixtures: { type: 'string', default: 'fixtures/github' },
      now: { type: 'string' },
      'history-from': { type: 'string' },
      'history-fixture': { type: 'string', default: 'fixtures/history/history.json' },
      'fresh-history': { type: 'boolean', default: false },
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

  const { file, allowDateTokens } = resolveExceptionsPath({
    source,
    config: values.config,
    exceptions: values.exceptions,
  });
  const { catalog, policies, exceptions } = await loadConfig(values.config, {
    exceptionsFile: file,
    allowDateTokens,
    now: clock(),
  });
  for (const w of exceptions.warnings) console.warn(`⚠ ${w.path}: ${w.message}`);
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
  const result = await runCollection({ catalog, policies, provider, clock, exceptions });
  // The previous history is read before writeSnapshots, which replaces the output directory.
  let extras: HistoryExtras = { history: null, changes: null };
  if (policies.history.enabled) {
    const now = new Date(result.index.generatedAt);
    const previous = await loadPreviousHistory({
      dataSource: source,
      historyFrom: historyDir(values['history-from'], process.env.HISTORY_FROM, values.out),
      fixturePath: values['history-fixture'],
      restoreState: process.env.HISTORY_RESTORE_STATE || undefined,
      fresh: values['fresh-history'],
      catalog,
      policies,
      now,
    });
    // Never throws: a history that cannot be used is set aside, the snapshots are still written.
    extras = buildHistoryExtras(previous, result.index, result.projects, catalog, policies, now);
    for (const note of extras.notes ?? []) console.warn(`⚠ History: ${note}`);
  }
  const report = await writeSnapshots(
    values.out,
    result.index,
    result.projects,
    catalog,
    result.discovery,
    extras,
  );

  for (const p of result.index.projects)
    console.log(
      `  ${p.id.padEnd(24)} overall=${p.overall.padEnd(5)} errors=${p.collectionErrorCount}`,
    );
  const r = report.repositories;
  console.log(
    `Repositories: ${r.total} total · ${r.ok} ok · ${r.withErrors} with errors · ${r.unavailable} unavailable`,
  );
  if (report.history)
    console.log(`History: ${report.history.state} · ${report.history.entries} entries`);
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
