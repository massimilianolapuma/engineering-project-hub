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
  await page.getByLabel('Status', { exact: true }).selectOption('grey');
  await expect(page.locator('tr[data-project]:not([hidden])')).toHaveCount(1);
  await expect(page.getByText('1 of 4 projects')).toBeVisible();
});

test('status counts filter the list and unknown projects show insufficient data, not zero', async ({
  page,
}) => {
  await page.goto('/');
  const rows = page.locator('tr[data-project]:not([hidden])');
  // Default order: score, worst first; insufficient data right after red.
  await expect(rows.first()).toHaveAttribute('data-score', '38');
  await expect(rows.nth(1)).toHaveAttribute('data-score', '');
  const counts = page.getByRole('group', { name: 'Filter by overall status' });
  const critical = counts.getByRole('button', { name: /Critical/ });
  await critical.click();
  await expect(rows).toHaveCount(1);
  await expect(critical).toHaveAttribute('aria-pressed', 'true');
  // Pressing the active count again clears the filter.
  await critical.click();
  await expect(critical).toHaveAttribute('aria-pressed', 'false');
  await expect(rows).toHaveCount(4);
  await expect(page.locator('tr[data-health="grey"]')).toContainText('insufficient data');
});

test('no horizontal scroll at phone width', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('tr[data-project]')).toHaveCount(4);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
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
  // "How to read" is a header utility link, outside the main navigation.
  await page.getByRole('banner').getByRole('link', { name: 'Come leggere', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Come leggere' })).toBeVisible();
  await page.getByRole('link', { name: /^EN/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'How to read' })).toBeVisible();
});

test('project detail explains why it is critical and cards open their section', async ({
  page,
}) => {
  await page.goto('/projects/project-beta/');
  await expect(page.getByRole('heading', { level: 2, name: 'Why it is Critical' })).toBeVisible();
  // The same reason is also the Delivery card's summary: scope to the why box (strict mode).
  await expect(
    page.locator('section.why').getByText('Continuous Integration failed on api (run #418)'),
  ).toBeVisible();
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

test('versions page does not scroll sideways at phone width', async ({ page }) => {
  for (const path of ['/versions/', '/it/versions/']) {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
    // Status labels fit their pill, never cut off.
    const clipped = await page
      .locator('.vissue .status-col > .pill')
      .evaluateAll((pills) => pills.filter((p) => p.scrollWidth > p.clientWidth).length);
    expect(clipped, path).toBe(0);
  }
});
