/**
 * Local real-data refresh: validate a git-ignored catalog, collect from GitHub, validate the
 * snapshots, build the site and scan the output, in one command.
 *
 *   npm run refresh:local [-- --config config.local] [--gh-user <login>] [--no-build]
 *
 * Credentials: the GitHub App variables or GH_READ_TOKEN are used as they are (same priority
 * as the collector). When neither is set, the token of the GitHub CLI is used
 * (`gh auth token`, optionally for --gh-user or $HUB_GH_USER). The token is passed to the
 * child processes through the environment only: it is never printed or written to disk.
 *
 * The committed `config/` catalog describes synthetic repositories, so it is refused: real
 * data comes from a local catalog only, and the result must never be committed or published.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export interface RefreshOptions {
  config: string;
  ghUser?: string;
  build: boolean;
}

export type TokenSource = 'environment' | 'gh-cli';

export interface Step {
  label: string;
  args: string[];
}

const present = (v: string | undefined): boolean => typeof v === 'string' && v.trim() !== '';

/** Credentials already in the environment win; otherwise the GitHub CLI provides a token. */
export function tokenSource(env: NodeJS.ProcessEnv): TokenSource {
  const app = [env.GH_APP_ID, env.GH_APP_PRIVATE_KEY, env.GH_APP_INSTALLATION_ID].some(present);
  return app || present(env.GH_READ_TOKEN) ? 'environment' : 'gh-cli';
}

export function ghTokenArgs(ghUser?: string): string[] {
  return present(ghUser) ? ['auth', 'token', '--user', ghUser!.trim()] : ['auth', 'token'];
}

/** The committed catalog is synthetic: collecting it from GitHub only yields 404s. */
export function isCommittedConfig(config: string, cwd: string = process.cwd()): boolean {
  return resolve(cwd, config) === resolve(cwd, 'config');
}

export function refreshSteps(opts: RefreshOptions): Step[] {
  const steps: Step[] = [
    { label: 'validate config', args: ['run', 'validate:config', '--', opts.config] },
    { label: 'collect (github)', args: ['run', 'collect:github', '--', '--config', opts.config] },
    { label: 'validate snapshots', args: ['run', 'validate:snapshots'] },
  ];
  if (opts.build) {
    steps.push(
      { label: 'build site', args: ['run', 'build:site'] },
      { label: 'scan output', args: ['run', 'scan:output'] },
    );
  }
  return steps;
}

export function parseRefreshArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): RefreshOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: 'string', default: 'config.local' },
      'gh-user': { type: 'string' },
      'no-build': { type: 'boolean', default: false },
    },
  });
  const ghUser = values['gh-user'] ?? env.HUB_GH_USER;
  return {
    config: values.config,
    ...(present(ghUser) ? { ghUser: ghUser!.trim() } : {}),
    build: !values['no-build'],
  };
}

function readGhToken(ghUser?: string): string {
  try {
    return execFileSync('gh', ghTokenArgs(ghUser), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function main(): number {
  let opts: RefreshOptions;
  try {
    opts = parseRefreshArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`refresh:local: ${(e as Error).message}`);
    return 1;
  }
  if (isCommittedConfig(opts.config)) {
    console.error(
      'refresh:local: the committed config/ catalog is synthetic. Use a git-ignored local catalog (default config.local/).',
    );
    return 1;
  }
  if (!existsSync(opts.config)) {
    console.error(
      `refresh:local: ${opts.config}/ not found. Create it first (README → "GitHub mode").`,
    );
    return 1;
  }

  const env: NodeJS.ProcessEnv = { ...process.env, DATA_SOURCE: 'github' };
  const source = tokenSource(env);
  if (source === 'gh-cli') {
    const token = readGhToken(opts.ghUser);
    if (!token) {
      const who = opts.ghUser ? ` --user ${opts.ghUser}` : '';
      console.error(
        `refresh:local: no credentials. Set GH_READ_TOKEN or the GitHub App variables, or log in with "gh auth login" (checked: gh auth token${who}).`,
      );
      return 1;
    }
    env.GH_READ_TOKEN = token;
  }
  const via =
    source === 'gh-cli' ? `GitHub CLI${opts.ghUser ? ` (${opts.ghUser})` : ''}` : 'environment';
  console.log(`refresh:local · config=${opts.config} · credentials from ${via}`);

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const started = Date.now();
  for (const step of refreshSteps(opts)) {
    console.log(`\n▶ ${step.label}`);
    const r = spawnSync(npm, ['--silent', ...step.args], { env, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`\n✖ refresh:local stopped at "${step.label}" (exit ${r.status ?? 'signal'}).`);
      return r.status ?? 1;
    }
  }
  const secs = Math.round((Date.now() - started) / 1000);
  console.log(
    `\n✔ refresh:local done in ${secs} s.${opts.build ? ' Serve it with "npm run preview".' : ''} Local data only: do not commit or publish public/data or dist/.`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main());
}
