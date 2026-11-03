import { expect, test, type Page } from '@playwright/test';

const shown = (page: Page) => page.locator('tr[data-project]:not([hidden])');
const names = (page: Page) => shown(page).locator('.plist__link').allTextContents();
/** Phones fold the fields into one "Filters" disclosure; open it when it is closed. */
async function openFilters(page: Page) {
  const box = page.locator('details[data-filterbox]');
  if (!(await box.evaluate((d: HTMLDetailsElement) => d.open)))
    await box.locator('> summary').click();
}

test('team filter: several teams in the link show the union', async ({ page }) => {
  await page.goto('/?team=pay-project-alpha-dev&team=security');
  await expect(shown(page)).toHaveCount(2);
  expect((await names(page)).sort()).toEqual(['Platform (monorepo)', 'Project Alpha']);
  await expect(page.locator('[data-results]')).toHaveText(
    '2 of 4 projects · 1 project without teams not shown',
  );
  // Matching teams come first in the row, in the accent tone.
  const alpha = page.locator('tr[data-project][data-name="project alpha"]');
  await expect(alpha.locator('.teamlabel:not([hidden])').first()).toHaveText(
    'pay-project-alpha-dev',
  );
  await expect(alpha.locator('.teamlabel--match')).toHaveCount(1);
});

test('team filter: unknown and hostile values render as text', async ({ page }) => {
  await page.goto('/?team=%3Cimg%20src%3Dx%3E&team=nope');
  const chips = page.locator('[data-team-chips] .teamchip--unknown');
  await expect(chips).toHaveCount(2);
  await expect(chips.first()).toContainText('<img src=x>');
  await expect(chips.first()).toContainText('not in the catalog');
  await expect(page.locator('[data-team-chips] img')).toHaveCount(0);
  await expect(shown(page)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Remove team nope (not in the catalog)' }),
  ).toBeVisible();
});

test('team filter: a "$&" in a link value is named literally', async ({ page }) => {
  await page.goto('/?team=a%24%26b');
  await expect(
    page.getByRole('button', { name: 'Remove team a$&b (not in the catalog)' }),
  ).toBeVisible();
});

test('team filter: repeated and upper-case values count once', async ({ page }) => {
  await page.goto('/?team=Platform&team=platform&team=%20platform%20');
  await expect(page.locator('[data-team-chips] .teamchip')).toHaveCount(1);
  await expect(page).toHaveURL(/\?team=platform$/);
  await expect(shown(page)).toHaveCount(2);
});

test('team filter: chips, keyboard and clear', async ({ page }) => {
  await page.goto('/');
  await openFilters(page);
  const summary = page.locator('[data-team-filter] > summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  const platform = page.getByRole('checkbox', { name: /^platform/ });
  await platform.focus();
  await page.keyboard.press('Space');
  await expect(page).toHaveURL(/team=platform/);
  await expect(shown(page)).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-team-filter]')).toHaveJSProperty('open', false);
  const chip = page.getByRole('button', { name: 'Remove team platform' });
  await chip.focus();
  await page.keyboard.press('Enter');
  await expect(page).not.toHaveURL(/team=/);
  await expect(shown(page)).toHaveCount(4);

  await page.goto('/?team=platform&team=security&team=nope');
  await expect(shown(page)).toHaveCount(2);
  await page.locator('.portfolio__clear').click();
  await expect(page).not.toHaveURL(/team=/);
  await expect(page.locator('[data-team-chips] .teamchip')).toHaveCount(0);
  await expect(shown(page)).toHaveCount(4);
});

test('team filter: survives back navigation', async ({ page }) => {
  await page.goto('/?team=platform');
  await expect(shown(page)).toHaveCount(2);
  await page.getByRole('link', { name: 'Project Alpha', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/project-alpha\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/\?team=platform$/);
  // The panel is closed, so its checkbox is out of the accessibility tree: find it by value.
  await expect(page.locator('input[name="team"][value="platform"]')).toBeChecked();
  await expect(page.locator('[data-team-count]')).toHaveText('1');
  await expect(page.getByRole('button', { name: 'Remove team platform' })).toBeVisible();
  await expect(shown(page)).toHaveCount(2);
});

test('project page lists its teams as links to the filtered portfolio', async ({ page }) => {
  await page.goto('/projects/project-alpha/');
  const meta = page.locator('.phead__meta');
  await expect(meta).toContainText('pay-project-alpha-dev');
  await expect(meta.getByRole('link', { name: 'platform' })).toHaveAttribute(
    'href',
    '/?team=platform',
  );
});

test('team filter in Italian', async ({ page }) => {
  await page.goto('/it/?team=platform');
  await expect(shown(page)).toHaveCount(2);
  await expect(page.locator('[data-results]')).toHaveText(
    '2 di 4 progetti · 1 progetto senza team non mostrato',
  );
  await expect(page.getByRole('button', { name: 'Rimuovi il team platform' })).toBeVisible();
  await page.goto('/it/projects/project-alpha/');
  await expect(
    page.locator('.phead__meta').getByRole('link', { name: 'platform' }),
  ).toHaveAttribute('href', '/it/?team=platform');
});

test('team filter does not scroll sideways at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?team=pay-project-alpha-dev&team=platform&team=security&team=nope');
  await page.locator('[data-team-filter] > summary').click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
