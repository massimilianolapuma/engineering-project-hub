import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ChangesFileSchema,
  PortfolioIndexSchema,
  type ChangesFile,
  type PortfolioIndex,
} from '@model/index';
import { findSecretPatterns, sensitiveEnvValues } from '../../shared/security/patterns';
import { DICTIONARIES } from '../../src/i18n';
import { loadNotificationsConfig } from './config';
import { buildDigest } from './digest';
import { postOnce } from './http';
import { appendLedger, loadLedger, saveLedger } from './ledger';
import { resolveMode } from './mode';
import { renderTeams } from './render/teams';

/*
 * One notifier run (spec §5.5.6), Microsoft Teams only (v0.15.0). Every payload is checked for
 * secrets before it is written or sent; in send mode a change set already in the ledger is never
 * posted again. The summary names outcomes and checks, never a URL, header or value.
 */

export interface RunOptions {
  snapshots: string;
  config: string;
  out: string;
  ledger?: string;
  env: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  now: () => Date;
}

export interface RunResult {
  exitCode: 0 | 1;
  summary: string;
}

const FAILING = new Set([
  'refused',
  'rejected',
  'not-authorised',
  'not-found',
  'too-large',
  'rate-limited',
  'error',
  'not-configured',
]);

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Names of the checks a payload fails: secret patterns and credential values from the env. */
function payloadHits(text: string, env: NodeJS.ProcessEnv): string[] {
  const hits = findSecretPatterns(text);
  if (sensitiveEnvValues(env).some((v) => text.includes(v))) hits.push('environment-credential');
  return hits;
}

export async function runNotifier(o: RunOptions): Promise<RunResult> {
  const rows: [string, string][] = [];
  const notes: string[] = [];
  let exitCode: 0 | 1 = 0;
  let mode: 'send' | 'dry-run' = 'dry-run';
  mkdirSync(o.out, { recursive: true });

  const finish = (): RunResult => {
    const summary = [
      '## Engineering Project Hub — notifications',
      '',
      '| Field | Value |',
      '|---|---|',
      ...rows.map(([k, v]) => `| ${k} | ${v} |`),
      '',
      ...notes.map((n) => `- ${n}`),
      '',
    ].join('\n');
    writeFileSync(join(o.out, 'summary.md'), summary, 'utf8');
    if (o.env.GITHUB_STEP_SUMMARY) appendFileSync(o.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    if (o.env.GITHUB_OUTPUT) appendFileSync(o.env.GITHUB_OUTPUT, `mode=${mode}\n`);
    return { exitCode, summary };
  };

  let config;
  try {
    config = loadNotificationsConfig(o.config);
  } catch {
    rows.push(['Notifications', 'invalid configuration (run validate:config)']);
    exitCode = 1;
    return finish();
  }
  if (config === null) {
    rows.push(['Notifications', 'not configured (no notifications.yaml)']);
    return finish();
  }

  const index = PortfolioIndexSchema.safeParse(readJson(join(o.snapshots, 'index.json')));
  const changes = ChangesFileSchema.safeParse(readJson(join(o.snapshots, 'changes.json')));
  if (!index.success || !changes.success) {
    rows.push(['Notifications', 'no change data (index.json or changes.json missing or invalid)']);
    return finish();
  }
  const idx: PortfolioIndex = index.data;
  const chg: ChangesFile = changes.data;

  const m = resolveMode({
    configMode: config.mode,
    variable: o.env.HUB_NOTIFICATIONS,
    envSource: o.env.DATA_SOURCE,
    index: idx,
    changes: chg,
  });
  mode = m.mode;
  rows.push(['Mode', m.mode === 'send' ? 'send' : `dry-run (${m.reason})`]);

  const digest = buildDigest(chg, idx, config);
  if (digest === null) {
    rows.push([
      'Change set',
      chg.basis.state === 'compared' ? 'no significant change' : `none (basis: ${chg.basis.state})`,
    ]);
    return finish();
  }
  rows.push(['Change set', digest.key], ['Projects', String(digest.totals.projects)]);

  const teams = renderTeams(digest, DICTIONARIES[digest.locale]);
  const files: [string, string][] = [
    ['digest.json', `${JSON.stringify(digest, null, 2)}\n`],
    ['teams.json', `${JSON.stringify({ method: 'POST', body: teams.body }, null, 2)}\n`],
  ];
  const hits = [...new Set(files.flatMap(([, text]) => payloadHits(text, o.env)))];
  if (hits.length) {
    rows.push(['Payload check', `refused (${hits.join(', ')}): nothing written or sent`]);
    exitCode = 1;
    return finish();
  }
  for (const [name, text] of files) writeFileSync(join(o.out, name), text, 'utf8');
  if (teams.omitted)
    notes.push(`${teams.omitted} project(s) left out of the Teams card to fit its size limit.`);

  let outcome: string;
  if (m.mode === 'dry-run') outcome = 'dry-run';
  else if (!config.targets.teams.enabled) outcome = 'off';
  else if (o.env.HUB_LEDGER_STATE === 'failed') {
    rows.push(['Teams', 'not sent']);
    notes.push('ledger unavailable: not sending to avoid duplicates');
    exitCode = 1;
    return finish();
  } else {
    const ledgerPath = o.ledger ?? join(o.out, 'ledger.json');
    let ledger;
    try {
      ledger = loadLedger(ledgerPath);
    } catch {
      rows.push(['Teams', 'not sent']);
      notes.push('ledger unavailable: not sending to avoid duplicates');
      exitCode = 1;
      return finish();
    }
    const url = o.env.TEAMS_WEBHOOK_URL ?? '';
    if (ledger.entries.some((e) => e.target === 'teams' && e.key === digest.key))
      outcome = 'skipped-duplicate';
    else if (!url) outcome = 'not-configured';
    else {
      const r = await postOnce({
        url,
        body: JSON.stringify(teams.body),
        allowedHostSuffixes: config.targets.teams.allowedHostSuffixes,
        fetch: o.fetch,
      });
      outcome = r.outcome;
      if (r.outcome === 'sent')
        saveLedger(
          ledgerPath,
          appendLedger(ledger, { target: 'teams', key: digest.key, sentAt: o.now().toISOString() }),
        );
    }
  }
  rows.push(['Teams', outcome]);
  if (FAILING.has(outcome)) exitCode = 1;
  return finish();
}
