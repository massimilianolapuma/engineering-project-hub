import { describe, expect, it } from 'vitest';
import {
  ghTokenArgs,
  isCommittedConfig,
  parseRefreshArgs,
  refreshSteps,
  tokenSource,
} from '../../scripts/refresh-local';

describe('refresh:local', () => {
  it('uses credentials already in the environment before the GitHub CLI', () => {
    expect(tokenSource({ GH_READ_TOKEN: 'x' })).toBe('environment');
    expect(tokenSource({ GH_APP_ID: '1' })).toBe('environment');
    expect(tokenSource({ GH_READ_TOKEN: '  ' })).toBe('gh-cli');
    expect(tokenSource({})).toBe('gh-cli');
  });

  it('asks gh for a specific account only when one is given', () => {
    expect(ghTokenArgs()).toEqual(['auth', 'token']);
    expect(ghTokenArgs(' ')).toEqual(['auth', 'token']);
    expect(ghTokenArgs('octo')).toEqual(['auth', 'token', '--user', 'octo']);
  });

  it('refuses the committed synthetic catalog', () => {
    expect(isCommittedConfig('config', '/repo')).toBe(true);
    expect(isCommittedConfig('./config/', '/repo')).toBe(true);
    expect(isCommittedConfig('config.local', '/repo')).toBe(false);
  });

  it('defaults to config.local, a build and $HUB_GH_USER', () => {
    expect(parseRefreshArgs([], {})).toEqual({ config: 'config.local', build: true });
    expect(parseRefreshArgs([], { HUB_GH_USER: 'octo' })).toEqual({
      config: 'config.local',
      ghUser: 'octo',
      build: true,
    });
    expect(
      parseRefreshArgs(['--config', 'my.cfg', '--gh-user', 'cli', '--no-build'], {
        HUB_GH_USER: 'env',
      }),
    ).toEqual({ config: 'my.cfg', ghUser: 'cli', build: false });
  });

  it('collects the chosen catalog from GitHub, then validates, builds and scans', () => {
    expect(refreshSteps({ config: 'config.local', build: true }).map((s) => s.args)).toEqual([
      ['run', 'validate:config', '--', 'config.local'],
      ['run', 'collect:github', '--', '--config', 'config.local'],
      ['run', 'validate:snapshots'],
      ['run', 'build:site'],
      ['run', 'scan:output'],
    ]);
    expect(refreshSteps({ config: 'c', build: false }).map((s) => s.label)).toEqual([
      'validate config',
      'collect (github)',
      'validate snapshots',
    ]);
  });
});
