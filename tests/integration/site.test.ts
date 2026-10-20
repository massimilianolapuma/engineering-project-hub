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

  it('never renders unknown counts as zero', async () => {
    const html = await page('');
    const gamma = html.slice(html.indexOf('data-name="project gamma"'));
    const row = gamma.slice(0, gamma.indexOf('</tr>'));
    expect(row).toContain('count--unknown');
    expect(row).not.toMatch(/class="count[^"]*"[^>]*>\s*0\s*</);
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
      expect(alpha).toContain('other open alert(s)');
    });

    it('shows insufficient data and its cause for an unreadable project', async () => {
      const html = await page('projects/project-gamma');
      const head = between(html, '<main', 'id="h-why"');
      expect(head).toContain('insufficient data');
      expect(head).toContain('score__value--none');
      expect(head).not.toMatch(/class="score__value"[^>]*>\s*0\s*</);
      const why = between(html, 'id="h-why"', '</section>');
      expect(why).toContain('2 collection error(s)');
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
        expect(row, idRow).toContain('1 high · 1 medium · 1 low');
        expect(row, idRow).toContain('shared repository');
        expect(row, idRow).toContain('All required enabled');
        expect(row, idRow).toContain('Success');
      }
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

    it('renders the Italian project page in Italian', async () => {
      const html = await page('it/projects/project-beta');
      expect(html).toContain('Perché è critico');
      expect(html).toContain('misurato 5 di 5');
      expect(html).toContain('Ambienti');
    });
  });

  it('distinguishes alerts from coverage on the security view and withholds private details', async () => {
    const html = await page('security');
    expect(html).toContain('Coverage by repository and control');
    expect(html).toContain('Not authorised');
    expect(html).toContain('Not configured');
    expect(html).toContain('Details withheld');
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
