import { expect, test } from '@playwright/test';

const rows = '[data-cm-row]:not([hidden])';

test('control map: reachable from the navigation, one row per project', async ({ page }) => {
  await page.goto('/');
  const link = page.locator('.mainnav a[href$="/controls/"]');
  await link.scrollIntoViewIfNeeded();
  await link.click();
  await expect(page).toHaveURL(/\/controls\/$/);
  await expect(page.locator('h1')).toHaveText('Control map');
  await expect(page.locator(rows)).toHaveCount(4);
});

test('control map: a cell opens its detail by keyboard, Escape returns to the cell', async ({
  page,
}) => {
  await page.goto('/controls/');
  const cell = page.locator('[data-cm-cell="cm-d-project-alpha-sbom-coverage"]');
  await cell.focus();
  await page.keyboard.press('Enter');
  const detail = page.locator('#cm-detail');
  await expect(detail).toBeFocused();
  await expect(detail).toContainText('SBOM coverage · Project Alpha');
  await expect(detail).toContainText('RTS art. 4–5');
  await expect(cell).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(cell).toBeFocused();
});

test('control map: ?team= and the business-unit filter keep only matching rows', async ({
  page,
}) => {
  await page.goto('/controls/?team=pay-project-beta-dev');
  await expect(page.locator(rows)).toHaveCount(1);
  await expect(page.locator('[data-cm-team]')).toBeVisible();
  await page.goto('/controls/');
  await page.locator('[data-cm-filter="bu"]').selectOption('Payments');
  await expect(page).toHaveURL(/\?bu=Payments$/);
  const n = await page.locator(rows).count();
  expect(n).toBeGreaterThan(0);
  for (const bu of await page.locator(rows).evaluateAll((r) => r.map((x) => x.dataset.bu)))
    expect(bu).toBe('Payments');
});

test('control map: the area filter hides the other columns', async ({ page }) => {
  await page.goto('/controls/?area=secrets');
  await expect(page.locator('thead th[data-check]:not([hidden])')).toHaveCount(3);
});

test('control map: no sideways page scroll on a phone, only the table scrolls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/controls/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const scroller = page.locator('.cm-scroll');
  expect(await scroller.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
});
