import { describe, expect, it } from 'vitest';
import {
  HUB_REPOSITORY_URL,
  appPermissions,
  buildManifest,
  conversionCommands,
  defaultAppName,
  formAction,
  parseReturn,
  publicSetupUrl,
  validAppName,
  validDeployRepository,
  validOwner,
} from '../../src/lib/github-app-manifest';

describe('GitHub App manifest (one-click read-only collector App)', () => {
  it('requests only the read permissions the hub uses, plus members for team discovery', () => {
    const base = {
      metadata: 'read',
      contents: 'read',
      actions: 'read',
      security_events: 'read',
      vulnerability_alerts: 'read',
      secret_scanning_alerts: 'read',
      deployments: 'read',
    };
    expect(appPermissions('organization', false)).toEqual(base);
    expect(appPermissions('organization', true)).toEqual({ ...base, members: 'read' });
    // Members is an organisation permission: a personal account never asks for it.
    expect(appPermissions('user', true)).toEqual(base);
    for (const level of Object.values(appPermissions('organization', true)))
      expect(level).toBe('read');
  });

  it('builds a private App with the webhook off and the page as redirect', () => {
    const m = buildManifest({
      account: 'organization',
      owner: 'acme',
      name: 'acme-project-hub',
      redirectUrl: 'https://example.test/setup/github-app/',
      teams: false,
    });
    expect(m).toEqual({
      name: 'acme-project-hub',
      url: HUB_REPOSITORY_URL,
      description: 'Read-only collector for Engineering Project Hub.',
      hook_attributes: { url: HUB_REPOSITORY_URL, active: false },
      redirect_url: 'https://example.test/setup/github-app/',
      public: false,
      default_permissions: appPermissions('organization', false),
      default_events: [],
    });
  });

  it('posts to the organisation or personal App creation page with the state', () => {
    expect(formAction('organization', 'acme', 'abc123')).toBe(
      'https://github.com/organizations/acme/settings/apps/new?state=abc123',
    );
    expect(formAction('user', 'jdoe', 'abc123')).toBe(
      'https://github.com/settings/apps/new?state=abc123',
    );
  });

  it('validates owners, App names and deploy repositories', () => {
    for (const ok of ['acme', 'a', 'acme-corp', 'A1-b2']) expect(validOwner(ok), ok).toBe(true);
    for (const bad of ['', '-acme', 'acme-', 'ac--me', 'ac me', 'acme/x', 'a'.repeat(40)])
      expect(validOwner(bad), bad).toBe(false);
    expect(validAppName('acme-project-hub')).toBe(true);
    expect(validAppName('a'.repeat(34))).toBe(true);
    expect(validAppName('a'.repeat(35))).toBe(false);
    expect(validAppName('   ')).toBe(false);
    expect(defaultAppName('acme')).toBe('acme-project-hub');
    expect(defaultAppName('a'.repeat(39))).toHaveLength(34);
    expect(validDeployRepository('acme/hub-deploy')).toBe(true);
    expect(validDeployRepository('acme/hub.deploy_1')).toBe(true);
    for (const bad of ['acme', 'acme/', '/x', 'acme/x y', 'acme/x;rm', 'a/b/c'])
      expect(validDeployRepository(bad), bad).toBe(false);
  });

  it('accepts the returned code only with the state saved before leaving', () => {
    expect(parseReturn('', 's1')).toEqual({ kind: 'none' });
    expect(parseReturn('?code=a180b1a3d263c81bc6441d7b990bae27d4c10679&state=s1', 's1')).toEqual({
      kind: 'code',
      code: 'a180b1a3d263c81bc6441d7b990bae27d4c10679',
    });
    expect(parseReturn('?code=abc12345&state=other', 's1')).toEqual({ kind: 'state-mismatch' });
    expect(parseReturn('?code=abc12345&state=s1', null)).toEqual({ kind: 'state-mismatch' });
    expect(parseReturn('?code=abc12345', 's1')).toEqual({ kind: 'state-mismatch' });
  });

  it('never turns a crafted code into a shell command', () => {
    for (const code of ['$(id)', 'abc;rm -rf ~', 'abc`id`', "abc'", 'a b', 'x'.repeat(200)])
      expect(parseReturn(`?code=${encodeURIComponent(code)}&state=s1`, 's1')).toEqual({
        kind: 'invalid-code',
      });
  });

  it('links the public setup page in the reader language', () => {
    expect(publicSetupUrl('en')).toBe(
      'https://massimilianolapuma.github.io/engineering-project-hub/setup/github-app/',
    );
    expect(publicSetupUrl('it')).toBe(
      'https://massimilianolapuma.github.io/engineering-project-hub/it/setup/github-app/',
    );
  });

  it('prints the conversion and secret commands, deleting the key file at the end', () => {
    const cmd = conversionCommands('abc12345', 'acme/hub-deploy');
    expect(cmd).toContain(
      '(umask 077 && gh api -X POST app-manifests/abc12345/conversions > hub-app.json)',
    );
    expect(cmd).toContain(
      'gh secret set GH_APP_ID --repo acme/hub-deploy --body "$(jq -r .id hub-app.json)"',
    );
    expect(cmd).toContain(
      'jq -r .pem hub-app.json | gh secret set GH_APP_PRIVATE_KEY --repo acme/hub-deploy',
    );
    expect(cmd).toContain('jq -r .html_url hub-app.json');
    expect(cmd.trim().split('\n').at(-1)).toBe('rm hub-app.json');
    expect(conversionCommands('abc12345', null)).toContain('--repo <owner>/<deploy-repository>');
  });
});
