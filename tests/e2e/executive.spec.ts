import { expect, test, type Page } from '@playwright/test';

const risks = (page: Page) => page.locator('[data-risk]:not([hidden])');

test('executive summary: reachable from the navigation', async ({ page }) => {
  await page.goto('/');
  const link = page.locator('.mainnav a[href$="/executive/"]');
  // Phones scroll the navigation horizontally: the link exists and works either way.
  await link.scrollIntoViewIfNeeded();
  await link.click();
  await expect(page).toHaveURL(/\/executive\/$/);
  await expect(page.locator('h1')).toHaveText('Executive summary');
  await expect(risks(page)).toHaveCount(4);
  await expect(page.locator('[data-exec-filter]')).toBeHidden();
});

test('executive summary: ?team= recomputes the page and never prints the team', async ({
  page,
}) => {
  await page.goto('/executive/?team=pay-project-beta-dev');
  await expect(page.locator('[data-exec-filter]')).toBeVisible();
  await expect(page.locator('[data-slot="filtered"]')).toHaveText(
    'Filtered by team: 1 of 4 projects',
  );
  await expect(risks(page)).toHaveCount(1);
  await expect(page.locator('[data-slot="tiles.red"]')).toHaveText('1');
  await expect(page.locator('main')).not.toContainText('pay-project-beta-dev');

  await page.locator('[data-exec-filter] a').click();
  await expect(page).toHaveURL(/\/executive\/$/);
  await expect(risks(page)).toHaveCount(4);
});

test('executive summary: an unknown team shows no project, as text', async ({ page }) => {
  await page.goto('/executive/?team=%3Cimg%20src%3Dx%3E');
  await expect(page.locator('[data-slot="filtered"]')).toHaveText(
    'Filtered by team: 0 of 4 projects',
  );
  await expect(risks(page)).toHaveCount(0);
  await expect(page.locator('[data-risks-none]')).toBeVisible();
  await expect(page.locator('main img')).toHaveCount(0);
});

test('executive summary: print hides the navigation and the filter link', async ({ page }) => {
  await page.goto('/executive/?team=pay-project-beta-dev');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.mainnav')).toBeHidden();
  await expect(page.locator('.exec__filter-link')).toBeHidden();
  await expect(page.locator('[data-slot="filtered"]')).toBeVisible();
});
