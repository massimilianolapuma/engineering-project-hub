import { expect, test, type Page } from '@playwright/test';

const projectList = (page: Page) =>
  page.getByRole('region', { name: 'Projects', exact: true }).getByRole('list').first();
const yaml = (page: Page) => page.getByRole('textbox', { name: 'Generated config/projects.yaml' });

test('links an unmapped submodule as a component and updates the YAML', async ({ page }) => {
  await page.goto('/catalog/');
  await expect(page.getByRole('heading', { level: 1, name: 'Catalog editor' })).toBeVisible();
  await expect(yaml(page)).toHaveValue(/projects:\n {2}- id: project-alpha/);

  await projectList(page)
    .getByRole('button', { name: /Project Beta/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Editing Project Beta' })).toBeVisible();

  const suggestion = page
    .getByRole('region', { name: 'Suggestions' })
    .getByRole('listitem')
    .filter({ hasText: 'tools/legacy-scripts' });
  await suggestion.getByRole('button', { name: 'Add as component' }).click();

  const row = page.getByRole('group', { name: 'Component 4' });
  await expect(row).toBeVisible();
  await expect(row.getByLabel('Id', { exact: true })).toHaveValue('legacy-scripts');
  await expect(row.getByLabel('Id', { exact: true })).toBeFocused();
  await expect(row.getByLabel('Submodule path')).toHaveValue('tools/legacy-scripts');
  await expect(row.getByLabel('Repository', { exact: true })).toHaveValue(
    'example-org/legacy-scripts',
  );
  await expect(suggestion.getByText('Linked')).toBeVisible();
  await expect(yaml(page)).toHaveValue(/submodulePath: tools\/legacy-scripts/);
  await expect(page.getByText('The catalog is valid.')).toBeVisible();

  // An invalid repository is reported in the live region and on the field.
  const repo = row.getByLabel('Repository', { exact: true });
  await repo.fill('not a repository');
  const validation = page.getByRole('region', { name: 'Validation' });
  await expect(
    validation.getByText('projects[1].components[3].repository: must be "owner/name"'),
  ).toBeVisible();
  await expect(repo).toHaveAttribute('aria-invalid', 'true');
  await expect(row.getByText('must be "owner/name"', { exact: true })).toBeVisible();

  await repo.fill('example-org/legacy-scripts');
  await expect(page.getByText('The catalog is valid.')).toBeVisible();
  await expect(repo).not.toHaveAttribute('aria-invalid', 'true');
});

test('the YAML covers every project and keeps defaults out', async ({ page }) => {
  await page.goto('/catalog/');
  const text = await yaml(page).inputValue();
  for (const id of ['project-alpha', 'project-beta', 'project-gamma'])
    expect(text).toContain(`- id: ${id}`);
  expect(text).not.toContain('versionSource: auto');
  expect(text).not.toMatch(/: ''$/m);
});

test('main controls are reachable and usable with the keyboard only', async ({ page }) => {
  await page.goto('/catalog/');
  await expect(yaml(page)).not.toHaveValue('');
  const wanted = new Set([
    'Project Beta',
    'New project',
    'Discard changes',
    'Id',
    'Remove this project',
    'Add component',
    'Copy YAML',
    'Download projects.yaml',
  ]);
  const seen = new Set<string>();
  for (let i = 0; i < 600 && seen.size < wanted.size; i++) {
    await page.keyboard.press('Tab');
    const name = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return '';
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement)
        return el.labels?.[0]?.firstChild?.textContent?.trim() ?? '';
      return (el.querySelector('.ce-project__name')?.textContent ?? el.textContent ?? '').trim();
    });
    if (wanted.has(name)) seen.add(name);
  }
  expect([...seen].sort()).toEqual([...wanted].sort());

  // Select a project and add a suggested component with the keyboard.
  await projectList(page)
    .getByRole('button', { name: /Project Beta/ })
    .focus();
  await page.keyboard.press('Enter');
  await expect(projectList(page).getByRole('button', { name: /Project Beta/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(projectList(page).getByRole('button', { name: /Project Beta/ })).toBeFocused();
  await page.getByRole('button', { name: 'Add as component' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('group', { name: 'Component 4' })).toBeVisible();
  await expect(page.locator(':focus')).toHaveValue('legacy-scripts');
});

test('renders in Italian at /it/catalog/', async ({ page }) => {
  await page.goto('/it/catalog/');
  await expect(page.getByRole('heading', { level: 1, name: 'Editor del catalogo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copia YAML' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Modifica di Project Alpha' })).toBeVisible();
});
