/*
 * One-click creation of the hub's read-only GitHub App through GitHub's App manifest flow
 * (docs: apps/sharing-github-apps/registering-a-github-app-from-a-manifest, checked 2026-11-04).
 * The page POSTs this manifest to GitHub; GitHub creates the App after the person confirms and
 * returns to the page with a one-hour code. The page never exchanges the code itself: it prints
 * the `gh` commands that do it on the person's machine, so the private key never reaches a server.
 * Pure functions: shared by the page script and the unit tests.
 */

export const HUB_REPOSITORY_URL = 'https://github.com/massimilianolapuma/engineering-project-hub';

const PUBLIC_SITE_URL = 'https://massimilianolapuma.github.io/engineering-project-hub/';

/** The setup page on the public demo site: restricted deployments link here (CSP form-action). */
export const publicSetupUrl = (locale: 'en' | 'it'): string =>
  `${PUBLIC_SITE_URL}${locale === 'en' ? '' : `${locale}/`}setup/github-app/`;

export type AccountType = 'organization' | 'user';

export interface ManifestInput {
  account: AccountType;
  owner: string;
  name: string;
  redirectUrl: string;
  /** Adds organisation Members: read (team discovery). Ignored for personal accounts. */
  teams: boolean;
}

/** GitHub App names are at most 34 characters. */
const APP_NAME_MAX = 34;
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\/[A-Za-z0-9._-]{1,100}$/;
/** Only letters and digits: the code is pasted into a shell command. */
const CODE_RE = /^[A-Za-z0-9]{8,128}$/;

export const validOwner = (s: string): boolean => OWNER_RE.test(s);
export const validDeployRepository = (s: string): boolean => REPO_RE.test(s);
export const validAppName = (s: string): boolean =>
  s.trim().length > 0 && s.trim().length <= APP_NAME_MAX;
export const defaultAppName = (owner: string): string =>
  `${owner}-project-hub`.slice(0, APP_NAME_MAX);

/** Read-only repository permissions the collector uses (docs/security.md, authorisation model). */
export function appPermissions(account: AccountType, teams: boolean): Record<string, 'read'> {
  return {
    metadata: 'read',
    contents: 'read',
    actions: 'read',
    security_events: 'read',
    vulnerability_alerts: 'read',
    secret_scanning_alerts: 'read',
    deployments: 'read',
    ...(account === 'organization' && teams ? { members: 'read' as const } : {}),
  };
}

export function buildManifest(input: ManifestInput) {
  return {
    name: input.name.trim(),
    url: HUB_REPOSITORY_URL,
    description: 'Read-only collector for Engineering Project Hub.',
    hook_attributes: { url: HUB_REPOSITORY_URL, active: false },
    redirect_url: input.redirectUrl,
    public: false,
    default_permissions: appPermissions(input.account, input.teams),
    default_events: [] as string[],
  };
}

export function formAction(account: AccountType, owner: string, state: string): string {
  const q = `?state=${encodeURIComponent(state)}`;
  return account === 'organization'
    ? `https://github.com/organizations/${encodeURIComponent(owner)}/settings/apps/new${q}`
    : `https://github.com/settings/apps/new${q}`;
}

export type ReturnResult =
  | { kind: 'none' }
  | { kind: 'state-mismatch' }
  | { kind: 'invalid-code' }
  | { kind: 'code'; code: string };

/** Reads GitHub's redirect (?code=…&state=…) against the state saved before leaving. */
export function parseReturn(search: string, expectedState: string | null): ReturnResult {
  const params = new URLSearchParams(search);
  const code = params.get('code');
  if (code === null) return { kind: 'none' };
  if (!expectedState || params.get('state') !== expectedState) return { kind: 'state-mismatch' };
  if (!CODE_RE.test(code)) return { kind: 'invalid-code' };
  return { kind: 'code', code };
}

/** Commands that turn the code into the App and store its id and key as deploy secrets. */
export function conversionCommands(code: string, deployRepository: string | null): string {
  if (!CODE_RE.test(code)) throw new Error('invalid manifest code');
  const repo =
    deployRepository && validDeployRepository(deployRepository)
      ? deployRepository
      : '<owner>/<deploy-repository>';
  return [
    '# Within one hour of creating the App. Needs gh (logged in) and jq.',
    `(umask 077 && gh api -X POST app-manifests/${code}/conversions > hub-app.json)`,
    `gh secret set GH_APP_ID --repo ${repo} --body "$(jq -r .id hub-app.json)"`,
    `jq -r .pem hub-app.json | gh secret set GH_APP_PRIVATE_KEY --repo ${repo}`,
    '# Open this page, then Install App only on the repositories to monitor:',
    'jq -r .html_url hub-app.json',
    'rm hub-app.json',
  ].join('\n');
}
