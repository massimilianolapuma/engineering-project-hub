import { expect, test } from '@playwright/test';

test('portfolio lists projects with separate health dimensions and a legend', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeVisible();
  await expect(page.locator('tr[data-project]')).toHaveCount(4);
  await expect(page.getByRole('complementary', { name: 'Legend' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'How to read' })).toBeVisible();
});

test('filters are keyboard accessible and narrow the list', async ({ page, isMobile }) => {
  await page.goto('/');
  if (isMobile) {
    // Phones: the fields sit in one "Filters" disclosure, closed until opened.
    await page.locator('[data-filterbox] > summary').focus();
    await page.keyboard.press('Enter');
  }
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
  await expect(rows.first()).toHaveAttribute('data-score', '40');
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

test('no horizontal scroll at tablet width and the reason stays fully visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1000 });
  await page.goto('/');
  await expect(page.locator('tr[data-project]')).toHaveCount(4);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const plist = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.plist')!;
    return el.scrollWidth - el.clientWidth;
  });
  expect(plist).toBeLessThanOrEqual(0);
  for (const cell of await page.locator('td.plist__reason').all()) {
    const box = (await cell.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(768);
  }
});

test('filters live in the URL, apply on load and can be cleared from the empty state', async ({
  page,
}) => {
  await page.goto('/?q=zzz-nothing');
  const rows = page.locator('tr[data-project]:not([hidden])');
  await expect(rows).toHaveCount(0);
  await expect(page.getByLabel('Search projects')).toHaveValue('zzz-nothing');
  await page.locator('[data-empty]').getByRole('button', { name: 'Clear filters' }).click();
  await expect(rows).toHaveCount(4);
  await expect(page).toHaveURL(/\/$/);
  await page.getByLabel('Status', { exact: true }).selectOption('red');
  await expect(page).toHaveURL(/\?health=red$/);
  await page.reload();
  await expect(rows).toHaveCount(1);
});

test('sorting by critical alerts never puts an unknown count at the bottom', async ({ page }) => {
  await page.goto('/?sort=critical');
  const names = await page
    .locator('tr[data-project]:not([hidden])')
    .evaluateAll((rs) => rs.map((r) => (r as HTMLElement).dataset.name));
  expect(names).toEqual(['project beta', 'project gamma', 'platform (monorepo)', 'project alpha']);
});

test('the chosen theme survives navigation', async ({ page }) => {
  await page.goto('/');
  const toggle = page.locator('[data-theme-toggle]');
  await toggle.click(); // Auto → Light
  await toggle.click(); // Light → Dark
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Security' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveText('Dark');
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
  await expect(page.getByText('measured 6 of 6')).toBeVisible();
  const workflows = page.locator('details#workflows');
  await expect(workflows).toHaveJSProperty('open', false);
  await page.locator('a[data-dimension="delivery"]').click();
  await expect(workflows).toHaveJSProperty('open', true);
  await expect(page.locator('details#coverage')).toHaveJSProperty('open', false);
  await page.locator('details#coverage > summary').click();
  await expect(page.locator('details#coverage')).toHaveJSProperty('open', true);
});

test('project page: Quality card links to #quality', async ({ page }) => {
  await page.goto('/projects/project-beta/');
  const card = page.locator('a[data-dimension="quality"]');
  await expect(card).toContainText('Tests: 67.2% of lines · threshold 80%');
  await card.click();
  await expect(page).toHaveURL(/#quality$/);
  const section = page.locator('section#quality');
  await expect(section.getByRole('heading', { level: 2, name: 'Code quality' })).toBeInViewport();
  await expect(section.getByText('Does not mean 0%.')).toBeVisible();
  // The meter is decorative: the number next to it carries the value.
  await expect(section.locator('.meter').first()).toHaveAttribute('aria-hidden', 'true');
  await expect(section.getByRole('img', { name: /not visible/i }).first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('project page has no horizontal scroll at phone width', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone layout only');
  for (const id of ['project-beta', 'project-gamma', 'platform']) {
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

test('the open-alerts filter says how many projects it hid for unknown counts', async ({
  page,
}) => {
  await page.goto('/?severity=critical');
  await expect(page.locator('tr[data-project]:not([hidden])')).toHaveCount(1);
  await expect(page.locator('[data-results]')).toHaveText(
    '1 of 4 projects · 1 project with unknown counts not shown',
  );
  await page.goto('/it/?severity=high');
  await expect(page.locator('[data-results]')).toContainText(
    '1 progetto con conteggi sconosciuti non mostrato',
  );
});

test('phone: filters fold into one disclosure and the nav scrolls inside itself', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const box = page.locator('details[data-filterbox]');
  await expect(box).toHaveJSProperty('open', false);
  await expect(page.getByLabel('Search projects')).toBeHidden();
  // The first project starts within the first screen (was ~765px; the fixtures are old, so
  // this includes the ~70px stale-data banner).
  const first = (await page.locator('tr[data-project]').first().boundingBox())!;
  expect(first.y).toBeLessThan(600);
  // One nav row that scrolls inside itself; the page never scrolls sideways.
  const nav = await page.evaluate(() => {
    const ul = document.querySelector<HTMLElement>('.mainnav ul')!;
    const links = [...ul.querySelectorAll('a')].map((a) => a.getBoundingClientRect().top);
    const el = document.querySelector<HTMLElement>('.mainnav')!;
    return {
      rows: new Set(links.map((t) => Math.round(t))).size,
      scrolls: el.scrollWidth > el.clientWidth,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(nav).toEqual({ rows: 1, scrolls: true, page: 0 });
  // On a page further along, the current link is scrolled into view inside the nav.
  await page.goto('/catalog/');
  const current = (await page.locator('.mainnav a[aria-current="page"]').boundingBox())!;
  expect(current.x + current.width).toBeLessThanOrEqual(375);
  // A filter in the URL opens the box, so the active filter is visible.
  await page.goto('/?bu=Payments');
  await expect(box).toHaveJSProperty('open', true);
  // Desktop keeps the inline row: the box is open and its summary hidden.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(box).toHaveJSProperty('open', true);
  await expect(box.locator('> summary')).toBeHidden();
});

test('project trend table opens with the keyboard', async ({ page }) => {
  await page.goto('/projects/project-alpha/');
  const summary = page.locator('#trend summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#trend table')).toBeVisible();
  await expect(page.locator('#trend tr[data-trend-row]')).toHaveCount(13);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('nav reaches What changed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'What changed' }).first().click();
  await expect(page).toHaveURL(/\/changes\/$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'What changed since last collection' }),
  ).toBeVisible();
  await expect(page.locator('article[id^="p-"]')).toHaveCount(4);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('CSV link responds 200 and starts with the BOM', async ({ page }) => {
  await page.goto('/');
  const link = page.getByRole('link', { name: 'Download CSV' });
  await expect(link).toHaveAttribute('href', '/exports/portfolio.csv');
  const res = await page.request.get('/exports/portfolio.csv');
  expect(res.status()).toBe(200);
  const body = await res.body();
  expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
});
