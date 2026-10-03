import { expect, test, type Page } from '@playwright/test';

const projectList = (page: Page) =>
  page.getByRole('region', { name: 'Projects', exact: true }).getByRole('list').first();
const yaml = (page: Page) => page.getByRole('textbox', { name: 'Generated project file' });
const pending = (page: Page) => page.getByRole('region', { name: 'Pending changes' });
const discovered = (page: Page) => page.getByRole('region', { name: 'Discovered repositories' });
const selectProject = async (page: Page, name: RegExp) => {
  await projectList(page).getByRole('button', { name }).click();
  await expect(projectList(page).getByRole('button', { name })).toHaveAttribute(
    'aria-current',
    'true',
  );
};

test('links an unmapped submodule as a component and updates the YAML', async ({ page }) => {
  await page.goto('/catalog/');
  await expect(page.getByRole('heading', { level: 1, name: 'Catalog editor' })).toBeVisible();
  // One file per project: the selected project's document, without the "projects:" wrapper.
  await expect(yaml(page)).toHaveValue(/\nid: platform\n/);
  await expect(yaml(page)).not.toHaveValue(/projects:/);

  await selectProject(page, /Project Beta/);
  await expect(page.getByRole('heading', { name: 'Editing Project Beta' })).toBeVisible();
  await expect(yaml(page)).toHaveValue(/\nid: project-beta\n/);

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
    validation.getByText('projects[2].components[3].repository: must be "owner/name"'),
  ).toBeVisible();
  await expect(repo).toHaveAttribute('aria-invalid', 'true');
  await expect(row.getByText('must be "owner/name"', { exact: true })).toBeVisible();
  // An invalid project cannot be proposed on GitHub.
  const change = pending(page).getByRole('listitem').filter({ hasText: 'Project Beta' });
  await expect(change.getByText('Fix the validation problems')).toBeVisible();
  await expect(change.getByRole('link', { name: /Edit on GitHub/ })).toHaveCount(0);

  await repo.fill('example-org/legacy-scripts');
  await expect(page.getByText('The catalog is valid.')).toBeVisible();
  await expect(repo).not.toHaveAttribute('aria-invalid', 'true');
});

test('the YAML of every project keeps defaults out', async ({ page }) => {
  await page.goto('/catalog/');
  for (const name of [/Platform/, /Project Alpha/, /Project Beta/, /Project Gamma/]) {
    await selectProject(page, name);
    const text = await yaml(page).inputValue();
    expect(text).toMatch(/^# yaml-language-server: \$schema=\.\.\/schema\/project\.schema\.json/);
    expect(text).not.toContain('versionSource: auto');
    expect(text).not.toMatch(/: ''$/m);
  }
  await expect(pending(page).getByText('No changes')).toBeVisible();
});

test('adds a discovered single repository as a new project proposed on GitHub', async ({
  page,
}) => {
  await page.goto('/catalog/');
  const region = discovered(page);
  await expect(region.getByText(/10 repositories scanned/)).toBeVisible();
  await expect(region.getByRole('heading', { name: 'Single repositories (1)' })).toBeVisible();
  const docs = region.getByRole('listitem').filter({ hasText: 'example-org/docs-site' }).first();
  await expect(docs.getByText('Single repository', { exact: true })).toBeVisible();
  await expect(docs.getByText('no submodules or workspace manifest')).toBeVisible();
  const platform = region
    .getByRole('listitem')
    .filter({ hasText: 'example-org/platform-mono' })
    .first();
  await expect(platform.getByText('Already in catalog: Platform (monorepo)')).toBeVisible();

  await docs.getByRole('button', { name: 'Add as project' }).click();
  await expect(page.getByRole('heading', { name: 'Editing Docs Site' })).toBeVisible();
  const name = page.getByLabel('Name', { exact: true }).first();
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Docs Site');
  await expect(page.getByText('Project type:')).toBeVisible();
  await expect(page.locator('[data-ce-kind]')).toContainText('Single repository');
  await expect(page.getByText(/No components: single-repository project/)).toBeVisible();
  await expect(docs.getByText('Added to the editor: Docs Site')).toBeVisible();
  // Nothing is saved: it only appears as a pending change.
  const change = pending(page).getByRole('listitem').filter({ hasText: 'Docs Site' });
  await expect(change.getByText('New', { exact: true })).toBeVisible();
  await expect(change.getByText('config/projects/docs-site.yaml')).toBeVisible();
  const propose = change.getByRole('link', { name: /Propose on GitHub \(new file\)/ });
  await expect(propose).toHaveAttribute(
    'href',
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/new\/main\?filename=config\/projects\/docs-site\.yaml&value=/,
  );
  await expect(propose).toHaveAttribute('target', '_blank');
  const href = (await propose.getAttribute('href'))!;
  expect(new URL(href).searchParams.get('value')).toBe(await yaml(page).inputValue());
  await expect(change.getByRole('button', { name: 'Download docs-site.yaml' })).toBeVisible();
});

test('an edited project is a modified file with an "Edit on GitHub" link', async ({ page }) => {
  await page.goto('/catalog/');
  await selectProject(page, /Project Gamma/);
  await page.getByLabel('Name', { exact: true }).first().fill('Gamma tools');
  const change = pending(page).getByRole('listitem').filter({ hasText: 'Gamma tools' });
  await expect(change.getByText('Modified', { exact: true })).toBeVisible();
  await expect(change.getByRole('link', { name: /Edit on GitHub/ })).toHaveAttribute(
    'href',
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/edit\/main\/config\/projects\/project-gamma\.yaml$/,
  );

  // Removing a project proposes the deletion of its file.
  await page.getByRole('button', { name: 'Remove this project' }).click();
  const removed = pending(page).getByRole('listitem').filter({ hasText: 'Project Gamma' });
  await expect(removed.getByText('Removed', { exact: true })).toBeVisible();
  await expect(removed.getByRole('link', { name: /Delete on GitHub/ })).toHaveAttribute(
    'href',
    /\/delete\/main\/config\/projects\/project-gamma\.yaml$/,
  );
});

test('a monorepo shows component paths and merges missing workflows', async ({ page }) => {
  await page.goto('/catalog/');
  await selectProject(page, /Platform/);
  await expect(page.locator('[data-ce-kind]')).toContainText('Monorepo');
  const api = page.getByRole('group', { name: 'Component 2' });
  const path = api.getByLabel(/^Path/);
  await expect(path).toHaveValue('services/api');
  await expect(api.getByText('Directory inside the repository (monorepo)')).toBeVisible();

  // The schema requires the path for a component in the coordinator repository.
  await path.fill('');
  await expect(path).toHaveAttribute('aria-invalid', 'true');
  await expect(api.getByText(/required when the component lives in the coordinator/)).toBeVisible();
  await path.fill('services/api');
  await expect(page.getByText('The catalog is valid.')).toBeVisible();

  // Compare with the discovered monorepo: the "docs.yml" workflow is missing.
  await discovered(page)
    .getByRole('listitem')
    .filter({ hasText: 'example-org/platform-mono' })
    .first()
    .getByRole('button', { name: 'Compare / merge' })
    .click();
  const merge = page.getByRole('region', { name: 'Compare with example-org/platform-mono' });
  await expect(merge.getByRole('heading', { name: /Compare with/ })).toBeFocused();
  const missing = merge.getByRole('listitem').filter({ hasText: 'docs.yml' });
  await missing.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('group', { name: 'Workflow 3' })).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Workflow 3' }).getByLabel('Id', { exact: true }),
  ).toBeFocused();
  await expect(merge.getByText(/Nothing to merge/)).toBeVisible();
  await expect(yaml(page)).toHaveValue(/file: docs\.yml/);
  await expect(
    pending(page).getByRole('listitem').filter({ hasText: 'Platform (monorepo)' }),
  ).toContainText('Modified');
});

test('main controls are reachable and usable with the keyboard only', async ({ page }) => {
  await page.goto('/catalog/');
  await expect(yaml(page)).not.toHaveValue('');
  const wanted = new Set([
    'Project Beta',
    'New project',
    'Discard changes',
    'Add as project',
    'Id',
    'Remove this project',
    'Add component',
    'Copy YAML',
    'Download platform.yaml',
    'Download all (legacy projects.yaml)',
  ]);
  const seen = new Set<string>();
  for (let i = 0; i < 800 && seen.size < wanted.size; i++) {
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
  await expect(
    page.getByRole('heading', { name: 'Modifica di Platform (monorepo)' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Repository scoperti' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Modifiche in sospeso' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aggiungi come progetto' })).toBeVisible();
});
