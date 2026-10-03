import { expect, test } from '@playwright/test';

test('portfolio lists projects with separate health dimensions and a legend', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeVisible();
  await expect(page.locator('tr[data-project]')).toHaveCount(4);
  await expect(page.getByRole('heading', { name: 'Legend' })).toBeVisible();
});

test('filters are keyboard accessible and narrow the list', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Search projects').focus();
  await page.keyboard.type('beta');
  await expect(page.locator('tr[data-project]:not([hidden])')).toHaveCount(1);
  await page.getByLabel('Search projects').fill('');
  await page.getByLabel('Overall health').selectOption('grey');
  await expect(page.locator('tr[data-project]:not([hidden])')).toHaveCount(1);
  await expect(page.getByText('1 of 4 projects')).toBeVisible();
});

test('navigates the main views in both languages', async ({ page }) => {
  await page.goto('/');
  for (const name of ['Workflows', 'Versions', 'Security', 'Data quality']) {
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name })
      .click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  }
  await page.getByRole('link', { name: /^IT/ }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.getByRole('heading', { level: 1, name: 'Qualità dati' })).toBeVisible();
});

test('project detail shows blocking component and coverage', async ({ page }) => {
  await page.goto('/projects/project-beta/');
  await expect(page.getByText('Blocking component: API service')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Security coverage' }).first()).toBeVisible();
});
