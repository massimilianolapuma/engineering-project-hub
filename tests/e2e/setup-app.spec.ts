import { expect, test } from '@playwright/test';

/*
 * GitHub App setup page: the manifest POST to github.com is intercepted (never sent), and the
 * return from GitHub is simulated with the state the page saved before leaving.
 */

test('posts a read-only manifest to the organisation App creation page', async ({ page }) => {
  let posted: { url: string; body: string } | null = null;
  await page.route('https://github.com/**', async (route) => {
    posted = { url: route.request().url(), body: route.request().postData() ?? '' };
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>intercepted</p>' });
  });
  await page.goto('/setup/github-app/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Create the GitHub App' }),
  ).toBeVisible();

  await page.getByLabel('Organisation or user name').fill('acme');
  await expect(page.getByLabel('App name')).toHaveValue('acme-project-hub');
  await page.getByLabel('Deploy repository (optional)').fill('acme/hub-deploy');
  await page.getByRole('button', { name: 'Create on GitHub' }).click();
  await expect(page.getByText('intercepted')).toBeVisible();

  expect(posted).not.toBeNull();
  const { url, body } = posted!;
  const state = new URL(url).searchParams.get('state');
  expect(url).toMatch(/^https:\/\/github\.com\/organizations\/acme\/settings\/apps\/new\?state=/);
  expect(state).toMatch(/^[0-9a-f]{32}$/);
  const manifest = JSON.parse(new URLSearchParams(body).get('manifest') ?? '{}');
  expect(manifest.name).toBe('acme-project-hub');
  expect(manifest.public).toBe(false);
  expect(manifest.hook_attributes.active).toBe(false);
  expect(manifest.redirect_url).toMatch(/\/setup\/github-app\/$/);
  expect(Object.values(manifest.default_permissions)).toEqual(Array(7).fill('read'));
  expect(manifest.default_permissions.members).toBeUndefined();
});

test('refuses an invalid owner without leaving the page', async ({ page }) => {
  await page.goto('/setup/github-app/');
  await page.getByLabel('Organisation or user name').fill('-bad-');
  await page.getByRole('button', { name: 'Create on GitHub' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Enter a valid GitHub organisation or user name.',
  );
  await expect(page).toHaveURL(/\/setup\/github-app\/$/);
});

test('shows the commands after GitHub returns with the saved state', async ({ page }) => {
  await page.goto('/setup/github-app/');
  await page.evaluate(() =>
    sessionStorage.setItem(
      'hub-app-setup',
      JSON.stringify({ state: 's'.repeat(32), deployRepository: 'acme/hub-deploy' }),
    ),
  );
  await page.goto(`/setup/github-app/?code=abc12345def&state=${'s'.repeat(32)}`);
  const result = page.getByRole('region', { name: 'App created: run these commands' });
  await expect(result).toBeVisible();
  await expect(result).toContainText('app-manifests/abc12345def/conversions');
  await expect(result).toContainText('--repo acme/hub-deploy');
  // The one-hour code leaves the address bar at once.
  await expect(page).toHaveURL(/\/setup\/github-app\/$/);
});

test('shows no command for a link that this tab did not start', async ({ page }) => {
  await page.goto('/setup/github-app/?code=abc12345def&state=forged');
  await expect(page.getByRole('alert')).toHaveText(
    /does not match a request started in this browser tab/,
  );
  await expect(page.getByText('app-manifests/')).toHaveCount(0);
  await expect(page).toHaveURL(/\/setup\/github-app\/$/);
});
