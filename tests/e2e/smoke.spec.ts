import { expect, test } from '@playwright/test';

test('portfolio lists projects with separate health dimensions and a legend', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeVisible();
  await expect(page.locator('tr[data-project]')).toHaveCount(4);
  await expect(page.getByRole('complementary', { name: 'Legend' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'How to read' })).toBeVisible();
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

test('status counts filter the sheet and unsurveyed projects are hatched, not zero', async ({
  page,
}) => {
  await page.goto('/');
  const counts = page.getByRole('group', { name: 'Filter by overall status' });
  await counts.getByRole('button', { name: /Critical/ }).click();
  await expect(page.locator('tr[data-project]:not([hidden])')).toHaveCount(1);
  await expect(counts.getByRole('button', { name: /Critical/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await counts.getByRole('button', { name: /Show all/ }).click();
  await expect(page.locator('tr[data-project]:not([hidden])')).toHaveCount(4);
  await expect(page.locator('tr[data-health="grey"] .sheet__band')).toContainText('Not surveyed');
});

test('navigates the main views in both languages', async ({ page }) => {
  await page.goto('/');
  for (const name of ['Security', 'Versions', 'Workflows', 'Data quality']) {
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

test('project detail explains why it is critical and cards open their section', async ({
  page,
}) => {
  await page.goto('/projects/project-beta/');
  await expect(page.getByRole('heading', { level: 2, name: 'Why it is Critical' })).toBeVisible();
  await expect(page.getByText('Continuous Integration failed on api (run #418)')).toBeVisible();
  await expect(page.getByText('measured 5 of 5')).toBeVisible();
  const workflows = page.locator('details#workflows');
  await expect(workflows).toHaveJSProperty('open', false);
  await page.locator('a[data-dimension="delivery"]').click();
  await expect(workflows).toHaveJSProperty('open', true);
  await expect(page.locator('details#coverage')).toHaveJSProperty('open', false);
  await page.locator('details#coverage > summary').click();
  await expect(page.locator('details#coverage')).toHaveJSProperty('open', true);
});

test('project page has no horizontal scroll at phone width', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout only');
  for (const id of ['project-beta', 'project-gamma']) {
    await page.goto(`/projects/${id}/`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, id).toBeLessThanOrEqual(0);
  }
});
