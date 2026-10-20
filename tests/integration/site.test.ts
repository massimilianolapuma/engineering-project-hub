import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'astro';
import { scan } from '../../scripts/scan-output';

/*
 * Builds the real Astro site from the golden mock snapshots (no backend, no network) and
 * checks the main views. Each build writes to its own temporary directory.
 */
let work: string;
let dist: string;

async function buildSite(dataDir: string, outDir: string) {
  process.env.SNAPSHOT_DIR = dataDir;
  process.env.ASTRO_TELEMETRY_DISABLED = '1';
  await build({ root: process.cwd(), outDir, logLevel: 'error', vite: { logLevel: 'error' } });
}
const page = (p: string) => readFile(join(dist, p, 'index.html'), 'utf8');

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'eph-site-'));
  dist = join(work, 'dist');
  await buildSite(join(process.cwd(), 'fixtures/snapshots'), dist);
}, 180_000);
afterAll(async () => {
  delete process.env.SNAPSHOT_DIR;
  await rm(work, { recursive: true, force: true });
});

const VIEWS = [
  '',
  'workflows',
  'versions',
  'security',
  'data-quality',
  'catalog',
  'projects/project-alpha',
  'projects/project-beta',
  'projects/project-gamma',
];

describe('static site', () => {
  it.each(VIEWS.flatMap((v) => [v, `it/${v}`.replace(/\/$/, '')]))('renders /%s', async (v) => {
    const html = await page(v);
    // Every page links to "How to read" from the header (the per-page legend strip is gone).
    expect(html).toMatch(/<a class="utility-link"[^>]*href="[^"]*how-to-read\/"/);
    expect(html).toMatch(/<main id="main"/);
    expect(html).not.toMatch(/>(undefined|NaN|null|\[object Object\])</);
  });

  it('shows separate health dimensions on the portfolio, with text + shape, not colour only', async () => {
    const html = await page('');
    for (const label of ['Delivery', 'Version', 'Security risk', 'Security coverage'])
      expect(html).toContain(label);
    expect(html).toMatch(/badge badge--red[^>]*>[\s\S]*?<svg[\s\S]*?Critical/);
    expect(html).toContain('data-project');
    expect(html).toMatch(/data-health="grey"/);
  });

  it('never renders unknown as zero: insufficient data, dashed, with its cause', async () => {
    const html = await page('');
    const gamma = html.slice(html.indexOf('data-name="project gamma"'));
    const row = gamma.slice(0, gamma.indexOf('</tr>'));
    // Empty score (no number): Astro serialises data-score="" as a bare attribute.
    expect(row).toMatch(/\sdata-score(="")?[\s>]/);
    expect(row).toContain('insufficient data');
    expect(row).toMatch(/dimbars__bar--grey/);
    expect(row).toMatch(/href="[^"]*data-quality\/#project-gamma"/);
    expect(row).toContain('2 collection error(s)');
    expect(row).not.toMatch(/>\s*0\s*</);
  });

  it('lists the portfolio by score, worst first, with insufficient data right after red', async () => {
    const html = await page('');
    expect(html).toContain('3 of 4 projects need attention');
    const names = [...html.matchAll(/<tr[^>]*data-project[^>]*data-name="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(names).toEqual([
      'project beta',
      'project gamma',
      'project alpha',
      'platform (monorepo)',
    ]);
    const beta = html.slice(html.indexOf('data-name="project beta"'));
    expect(beta.slice(0, beta.indexOf('>'))).toContain('data-score="38"');
    expect(html).toMatch(/<option value="score" selected/);
    // One-line legend under the list, linking to "How to read".
    expect(html).toMatch(/<a class="legend__link"[^>]*href="[^"]*how-to-read\/"/);
    // The v0.4.0 survey sheet is gone.
    expect(html).not.toMatch(/sheet__|sheet-/);
    expect(await page('it')).toContain('3 progetti su 4 chiedono attenzione');
  });

  it('renders Italian pages in Italian with lang="it"', async () => {
    const html = await page('it');
    expect(html).toContain('<html lang="it"');
    expect(html).toContain('Rischio sicurezza');
    expect(html).toContain('Legenda');
  });

  it('links to the original GitHub resources', async () => {
    const html = await page('projects/project-alpha');
    expect(html).toContain('href="https://github.com/example-org/project-alpha-coordinator"');
    expect(html).toMatch(
      /href="https:\/\/github\.com\/example-org\/project-alpha-frontend\/releases\/tag\/v2\.2\.0"/,
    );
  });

  describe('project page', () => {
    const between = (html: string, from: string, to: string) =>
      html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));

    it('shows the score with its confidence and explains why it is critical', async () => {
      const html = await page('projects/project-beta');
      const head = between(html, '<main', 'id="h-why"');
      expect(head).toMatch(/class="score__value"[^>]*>38</);
      expect(head).toContain('measured 5 of 5');
      expect(head).toMatch(/badge badge--red/);
      expect(html).toMatch(/<h2[^>]*id="h-why"[^>]*>Why it is Critical</);
      const why = between(html, 'id="h-why"', '</section>');
      // Red reasons come first, as sentences, with a link to the run.
      expect(why).toContain('Continuous Integration failed on api (run #418)');
      expect(why).toContain(
        'href="https://github.com/example-org/project-beta-api/actions/runs/9012"',
      );
      expect(why.indexOf('data-level="red"')).toBeLessThan(why.indexOf('data-level="amber"'));
    });

    it('links the five dimension cards to their sections', async () => {
      const html = await page('projects/project-beta');
      const cards = [...html.matchAll(/<a[^>]*\bhref="#([\w-]+)"[^>]*\bdata-dimension="(\w+)"/g)];
      expect(cards.map((m) => m[2])).toEqual([
        'delivery',
        'version',
        'security',
        'coverage',
        'governance',
      ]);
      expect(cards.map((m) => m[1])).toEqual([
        'workflows',
        'environments',
        'security',
        'coverage',
        'errors',
      ]);
      for (const id of ['workflows', 'environments', 'security', 'coverage', 'errors'])
        expect(html).toMatch(new RegExp(`\\bid="${id}"`));
    });

    it('draws environments as a DEV → UAT → PROD path with PROD behind', async () => {
      const html = await page('projects/project-beta');
      const envs = [...html.matchAll(/data-env="(\w+)"[^>]*data-env-status="(\w+)"/g)];
      expect(envs.map((m) => [m[1], m[2]])).toEqual([
        ['DEV', 'aligned'],
        ['UAT', 'aligned'],
        ['PROD', 'behind'],
      ]);
      expect(between(html, 'data-env="PROD"', '</li>')).toContain('Behind');
    });

    it('collapses workflows, security, coverage and collection errors', async () => {
      const html = await page('projects/project-beta');
      for (const id of ['workflows', 'security', 'coverage', 'errors']) {
        const tag = new RegExp(`<details[^>]*\\bid="${id}"[^>]*>`).exec(html);
        expect(tag, id).not.toBeNull();
        expect(tag![0]).not.toMatch(/\sopen[\s=>]/);
      }
    });

    it('lists only critical and high alerts, and links to GitHub for the rest', async () => {
      const beta = between(await page('projects/project-beta'), 'id="security"', '</details>');
      expect(beta).toContain('Header injection in example-http-client');
      expect(beta).toContain('Details withheld');
      expect(beta).toContain('href="https://github.com/example-org/project-beta-api/security"');
      const alpha = between(await page('projects/project-alpha'), 'id="security"', '</details>');
      expect(alpha).toContain('Prototype pollution in example-lib');
      expect(alpha).not.toContain('Missing rate limiting on public endpoint'); // medium
      expect(alpha).not.toContain('Use of a weak cryptographic algorithm'); // fixed
      expect(alpha).toContain('other open alert');
    });

    it('keeps an unlisted high alert apart from the other alerts', async () => {
      // Beta: 1 critical + 2 high open, but only 1 critical and 1 high have a finding record
      // (the second high comes from container scanning). It must not be counted as "other".
      const html = await page('projects/project-beta');
      const card = between(html, 'data-dimension="security"', '</a>');
      expect(card).toContain('1 critical · 2 high · 4 other');
      const security = between(html, 'id="security"', '</details>');
      expect(security).toContain('4 other open alerts are counted here');
      const unlisted = between(security, 'data-unlisted-crit-high', '</p>');
      expect(unlisted).toContain('no detail in the hub');
      expect(unlisted).toContain('1 high');
      expect(unlisted).not.toContain('critical');
    });

    it('shows insufficient data and its cause for an unreadable project', async () => {
      const html = await page('projects/project-gamma');
      const head = between(html, '<main', 'id="h-why"');
      expect(head).toContain('insufficient data');
      expect(head).toContain('score__value--none');
      expect(head).not.toMatch(/class="score__value"[^>]*>\s*0\s*</);
      const why = between(html, 'id="h-why"', '</section>');
      expect(why).toContain('2 collection errors');
      expect(why).toContain('Not found (404)');
      expect(why).toMatch(/href="[^"]*data-quality\/"/);
    });

    it('shows a newer release only when the collector reports drift', async () => {
      // Platform tags are prefixed (web-v2.0.1) and every component is aligned.
      const platform = between(await page('projects/platform'), 'id="h-components"', '</section>');
      expect(platform).not.toContain('latest web-v2.0.1');
      expect(platform).not.toContain('latest api-v1.8.0');
      expect(platform).not.toContain('latest worker-v0.4.0');
      const beta = between(await page('projects/project-beta'), 'data-component="api"', '</tr>');
      expect(beta).toContain('latest 3.2.0');
    });

    it('reads monorepo components from the shared repository', async () => {
      const comps = between(await page('projects/platform'), 'id="h-components"', '</section>');
      const rows = [...comps.matchAll(/<tr data-component="(\w+)"[\s\S]*?<\/tr>/g)];
      expect(rows.map((m) => m[1])).toEqual(['web', 'api', 'worker']);
      for (const [row, idRow] of rows) {
        expect(row, idRow).not.toContain('None required');
        expect(row, idRow).not.toContain('Unknown');
        expect(row, idRow).not.toContain('No critical workflow');
        // Shared counts are shown once under the table, not repeated on every row.
        expect(row, idRow).not.toContain('1 high');
        expect(row, idRow).toContain('shared repository');
        expect(row, idRow).toContain('All required enabled');
        expect(row, idRow).toContain('Success');
      }
      const note = between(comps, 'data-shared-alerts', '</p>');
      expect(note).toContain('Open alerts in the shared repository');
      expect(note).toContain('1 high · 1 medium · 1 low');
      expect(comps.match(/1 high · 1 medium · 1 low/g)).toHaveLength(1);
    });

    it('never shows unreadable coverage or alert counts as zero or complete', async () => {
      const gamma = await page('projects/project-gamma');
      const hint = between(gamma, 'id="coverage"', '</summary>');
      expect(hint).toContain('3 not visible');
      for (const m of gamma.matchAll(/0 of 3 required enabled/g)) {
        const line = gamma.slice(m.index! - 40, m.index! + 60);
        expect(line).toContain('not visible');
      }
      const security = between(gamma, 'id="security"', '</details>');
      expect(security).toContain('Alert counts unknown');
      expect(security).not.toContain('Partial: some sources could not be read');
      // Nothing could be read: no "partial" suffix that would suggest some counts are known.
      const gammaRows = between(gamma, 'id="h-components"', '</section>');
      expect(gammaRows).toContain('Unknown');
      expect(gammaRows).not.toContain('partial');
      // Beta: secret scanning is not authorised, so the card's counts are a lower bound.
      const beta = await page('projects/project-beta');
      const card = between(beta, 'data-dimension="security"', '</a>');
      expect(card).toContain('1 critical · 2 high · 4 other · partial');
      expect(between(beta, 'data-dimension="coverage"', '</a>')).toContain('1 not visible');
    });

    it('uses the singular for one blind control and one term for coordinator in Italian', async () => {
      const html = await page('it/projects/project-beta');
      expect(between(html, 'data-dimension="coverage"', '</a>')).toContain('1 non visibile');
      expect(html).not.toContain('coordinatore');
    });

    it('uses one severity vocabulary in Italian, number first', async () => {
      const html = await page('it/projects/project-beta');
      expect(between(html, 'data-dimension="security"', '</a>')).toContain(
        '1 critico · 2 high · 4 altri',
      );
      const security = between(html, 'id="security"', '</details>');
      expect(security).toContain('Altri 4 alert aperti');
      expect(between(security, 'data-unlisted-crit-high', '</p>')).toContain('1 high');
    });

    it('shows the declared version of a manifest mismatch as visible text', async () => {
      const html = await page('projects/project-beta');
      const flag = between(html, 'class="comps__flag"', '</td>');
      expect(flag).toContain('Mismatch');
      expect(flag).toMatch(/declared\s*<span class="mono"[^>]*>\s*\d+\.\d+\.\d+/);
    });

    it('agrees in gender and number in Italian', async () => {
      const html = await page('it/projects/project-gamma');
      expect(html).not.toContain('coordinator sconosciuto');
      expect(between(html, 'id="h-why"', '</section>')).toContain('2 errori di raccolta');
    });

    it('renders the Italian project page in Italian', async () => {
      const html = await page('it/projects/project-beta');
      expect(html).toContain('Perché è critico');
      expect(html).toContain('misurato 5 di 5');
      expect(html).toContain('Ambienti');
    });
  });

  it('shows only critical workflows that need attention, worst project first', async () => {
    const html = await page('workflows');
    const card = (id: string) => {
      const start = html.indexOf(`data-project="${id}"`);
      expect(start, id).toBeGreaterThan(-1);
      return html.slice(html.lastIndexOf('<article', start), html.indexOf('</article>', start));
    };
    // Summary sentence and read-only note.
    expect(html).toContain('1 critical workflow failed · 1 missing · 1 stale · 1 not visible');
    expect(html).toContain('The portal reads runs; it never triggers them.');
    // The v0.4.0 per-component matrix is gone.
    expect(html).not.toContain('table--matrix');
    // Worst first: Beta (red), Gamma (unknown), then the healthy ones by score.
    const order = ['project-beta', 'project-gamma', 'project-alpha', 'platform'].map((id) =>
      html.indexOf(`data-project="${id}"`),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));

    const beta = card('project-beta');
    const rows = beta.match(/<li class="wf-row[^"]*"[^>]*>[\s\S]*?<\/li>/g) ?? [];
    expect(rows).toHaveLength(3);
    const [failed, missing, stale] = rows as [string, string, string];
    for (const row of rows)
      expect(row).toMatch(/class="status-col[^"]*"[^>]*>\s*<span class="pill/);
    expect(failed).toContain('data-issue="failed"');
    expect(failed).toContain('ci-main.yml');
    expect(failed).toContain('example-org/project-beta-api');
    expect(failed).toContain(
      'href="https://github.com/example-org/project-beta-api/actions/runs/9012"',
    );
    expect(missing).toContain('data-issue="missing"');
    expect(missing).toContain('rel-release.yml');
    expect(missing).toContain('example-org/project-beta-web');
    expect(stale).toContain('data-issue="stale"');
    expect(stale).toContain('cd.yml');
    expect(stale).toContain('example-org/project-beta-helm');
    expect(stale).toContain('20 days before this collection');
    expect(beta).toMatch(/<details[^>]*>\s*<summary[^>]*>[^<]*3 critical workflows succeeded/);
    expect(beta).toContain('6 critical workflows · 3 to check');

    for (const [id, n] of [
      ['project-alpha', 8],
      ['platform', 2],
    ] as const) {
      const c = card(id);
      expect(c).toContain(`${n} critical workflows, all succeeded`);
      expect(c).not.toContain('wf-row');
      expect(c).toContain(`/projects/${id}/#workflows`);
    }

    const gamma = card('project-gamma');
    expect(gamma).toContain('wf-card--unknown');
    expect(gamma).toContain('data-issue="not-visible"');
    expect(gamma).toContain('Not visible');
    expect(gamma).toContain('Not authorised (403)');

    const it = await page('it/workflows');
    expect(it).toContain('Il portale legge le run, non le avvia mai.');
    expect(it).toContain(
      '1 workflow critico fallito · 1 mancante · 1 non aggiornato · 1 non visibile',
    );
    expect(it).toContain('Non visibile');
  });

  it('distinguishes alerts from coverage on the security view and withholds private details', async () => {
    const html = await page('security');
    expect(html).toContain('Coverage by repository and control');
    expect(html).toContain('Not authorised');
    expect(html).toContain('Not configured');
    expect(html).toContain('Details withheld');
  });

  it('shows security per project, worst first, with blind spots and no full alert table', async () => {
    const html = await page('security');
    // Portfolio severity totals: critical 1, high 4, medium 7, low 5 (Gamma unknown, not 0).
    const totals = /<section[^>]*data-security-totals[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    const values = [...totals.matchAll(/data-severity="(\w+)"[^>]*>\s*([^<\s]+)\s*</g)].map(
      ([, k, v]) => `${k}=${v}`,
    );
    expect(values).toEqual(['critical=1', 'high=4', 'medium=7', 'low=5']);
    expect(totals).toContain('Incomplete counts');
    // One card per project, in the portfolio order (score, insufficient data right after red).
    const order = [...html.matchAll(/<article[^>]*data-project="([\w-]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['project-beta', 'project-gamma', 'project-alpha', 'platform']);
    const card = (id: string) => {
      const start = html.lastIndexOf('<article', html.indexOf(`data-project="${id}"`));
      return html.slice(start, html.indexOf('</article>', start));
    };
    expect(card('project-beta')).toContain('Coverage: 2 of 4 required');
    expect(card('project-beta')).toContain('Not authorised (403)');
    expect(card('project-beta')).toMatch(/data-state="stale"[\s\S]*?⧖[\s\S]*?Container scanning/);
    expect(card('project-gamma')).toContain('does not mean zero alerts');
    expect(card('project-gamma')).toMatch(/class="[^"]*card--unknown/);
    expect(card('project-gamma')).not.toMatch(/data-count[^>]*>\s*0\s*</);
    // No full findings table; the portfolio coverage matrix is a closed, secondary section.
    expect(html).not.toContain('table--findings');
    expect(html).toMatch(
      /<details(?![^>]*\bopen\b)[^>]*>\s*<summary[^>]*>[\s\S]*?Coverage by repository and control[\s\S]*?<table/,
    );
    const it = await page('it/security');
    expect(it).toContain('Copertura: 2 di 4 richiesti');
    expect(it).toContain('Non significa zero alert.');
  });

  it('groups data quality by cause, with counts, stale sources and run details collapsed', async () => {
    const html = await page('data-quality');
    // Repository counts: in catalog / fully read / partly read / unreadable.
    for (const [key, n] of [
      ['total', 12],
      ['full', 7],
      ['partial', 3],
      ['unreadable', 2],
    ] as const)
      expect(html).toMatch(new RegExp(`data-repo-count="${key}"[^>]*>\\s*<span[^>]*>${n}<`));
    // What we could not read, grouped by classification (403: 4 sources, 404: 1 source).
    expect(html).toContain('What we could not read, by cause');
    expect(html).toMatch(/data-cause="not-authorised"[^>]*data-sources="4"/);
    expect(html).toMatch(/data-cause="not-found"[^>]*data-sources="1"/);
    expect(html.indexOf('data-cause="not-authorised"')).toBeLessThan(
      html.indexOf('data-cause="not-found"'),
    );
    const notAuth = html.slice(
      html.indexOf('data-cause="not-authorised"'),
      html.indexOf('data-cause="not-found"'),
    );
    expect(notAuth).toContain('Project Beta');
    expect(notAuth).toContain('Secret scanning');
    for (const r of ['project-beta-coordinator', 'project-beta-api', 'project-beta-web'])
      expect(notAuth).toContain(r);
    expect(notAuth).toContain('project-gamma-service');
    expect(html).toContain('we cannot tell which');
    expect(html).toContain('read access');
    // Portfolio deep links (/data-quality/#<project-id>) land on the project's first row.
    for (const id of ['project-beta', 'project-gamma']) {
      expect(html).toMatch(new RegExp(`<li[^>]*\\bid="${id}"`));
      expect(html.match(new RegExp(`\\bid="${id}"`, 'g'))).toHaveLength(1);
    }
    // Stale sources with their age and last update date.
    const stale = html.slice(html.indexOf('id="h-stale"'));
    expect(stale).toContain('project-beta-helm');
    expect(stale).toContain('Workflow runs');
    expect(stale).toContain('20 days');
    expect(stale).toContain('26 Dec 2025');
    // Unmapped submodule with a link to the catalog.
    const sub = html.slice(html.indexOf('id="h-submodules"'));
    expect(html).toContain('Submodules to check');
    expect(sub).toContain('tools/legacy-scripts');
    expect(sub).toMatch(/href="[^"]*\/catalog\/"/);
    // Capabilities as pills (shape + text), run details collapsed last.
    expect(html).toMatch(/pill pill--amber[\s\S]{0,400}Partial[\s\S]{0,200}Metadata/);
    expect(html).toMatch(/<details class="dq-run"(?![^>]*\bopen\b)[^>]*>\s*<summary/);
    expect(html.lastIndexOf('<section')).toBeLessThan(html.indexOf('<details class="dq-run"'));
    expect(html).not.toContain('kpi__value');

    const it = await page('it/data-quality');
    expect(it).toMatch(/<h1[^>]*>Qualità dati<\/h1>/);
    expect(it).toContain('Cosa non abbiamo potuto leggere, per causa');
    expect(it).toContain('20 giorni');
  });

  it('ships no inline script (CSP script-src self) and no secret patterns', async () => {
    const html = await page('');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    const { findings } = await scan([dist]);
    expect(findings).toEqual([]);
  });

  it.each(['catalog', 'it/catalog'])(
    'embeds the published catalog and suggestions on /%s without inline code',
    async (v) => {
      const html = await page(v);
      const json = /<script type="application\/json" id="catalog-data">([\s\S]*?)<\/script>/.exec(
        html,
      );
      expect(json).not.toBeNull();
      const data = JSON.parse(json![1]!) as {
        catalog: { projects: { id: string }[] };
        suggestions: { projectId: string; unmappedSubmodules: { path: string }[] }[];
      };
      expect(data.catalog.projects.map((p) => p.id)).toContain('project-beta');
      expect(
        data.suggestions
          .find((s) => s.projectId === 'project-beta')
          ?.unmappedSubmodules.map((m) => m.path),
      ).toContain('tools/legacy-scripts');
      expect(html).toContain('id="catalog-i18n"');
      expect(html).toContain('data-catalog-editor');
      // GitHub web-editor links (new / edit / delete config/projects/<id>.yaml) are built in
      // the browser from the repository slug of package.json; discovery proposals are embedded.
      const extra = data as unknown as {
        githubRepo: string | null;
        discovery: { proposals: { repository: string }[] } | null;
      };
      expect(extra.githubRepo).toMatch(/^[\w.-]+\/[\w.-]+$/);
      expect(extra.discovery?.proposals.map((p) => p.repository)).toContain(
        'example-org/docs-site',
      );
      // JSON blocks are data, not code: no other inline <script> may exist (CSP script-src 'self').
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>/);
      expect(html).toMatch(/<script type="module" src="[^"]*catalog[^"]*\.js"/);
      expect(html).toContain(v.startsWith('it') ? 'Editor del catalogo' : 'Catalog editor');
      const { findings } = await scan([join(dist, v)]);
      expect(findings).toEqual([]);
    },
  );

  it.each([
    ['catalog', 'Edit the projects and propose the changes as pull requests', 'Proposal'],
    ['it/catalog', 'Modifica i progetti e proponi le modifiche come pull request', 'Proposta'],
  ])('lays out /%s as a side list, the form and a proposal box', async (v, headline, proposal) => {
    const html = await page(v);
    // One dominant sentence under the title.
    expect(html).toMatch(new RegExp(`<p[^>]*class="ce-headline"[^>]*>${headline}</p>`));
    // Side list first: projects (with "New project"), discovered repositories, suggestions;
    // then the form, then the proposal box with validation, pending changes, the generated
    // file and "Discard changes".
    const order = [
      'class="ce__side"',
      'data-ce-projects',
      'data-ce-new',
      'data-ce-discovery',
      'data-ce-suggestions',
      'class="ce__main"',
      'data-ce-form',
    ].map((s) => html.indexOf(s));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const boxAt = html.search(/<section[^>]*class="card ce-proposal-box"/);
    expect(boxAt).toBeGreaterThan(order.at(-1)!);
    const box = html.slice(boxAt);
    expect(box).toMatch(new RegExp(`<h2[^>]*id="ce-h-proposal"[^>]*>${proposal}</h2>`));
    for (const hook of [
      'data-ce-validation',
      'data-ce-pending',
      'data-ce-yaml',
      'data-ce-copy',
      'data-ce-reset',
    ])
      expect(box).toContain(hook);
    // The accent is reserved for "Propose on GitHub" (added by the editor per change): no
    // static button is primary.
    expect(html).not.toContain('btn--primary');
    // How-to steps are detail on demand.
    expect(box).toMatch(/<details[^>]*class="ce-howto"/);
  });

  it('fails in a controlled way on an unsupported snapshot schemaVersion', async () => {
    const data = join(work, 'bad-data');
    await cp('fixtures/snapshots', data, { recursive: true });
    const idx = join(data, 'index.json');
    await writeFile(
      idx,
      (await readFile(idx, 'utf8')).replace('"schemaVersion": "1.3"', '"schemaVersion": "9.0"'),
    );
    const out = join(work, 'dist-bad');
    await buildSite(data, out);
    const html = await readFile(join(out, 'index.html'), 'utf8');
    expect(html).toContain('data-error-kind="unsupported-schema"');
    expect(html).toContain('9.0');
    // (Project pages are not generated either; verified by a standalone build — Astro caches
    // getStaticPaths between builds in the same process, so it is not asserted here.)
  }, 180_000);
});
