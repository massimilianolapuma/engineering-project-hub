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
    expect(html).toContain('class="legend"');
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
      (await readFile(idx, 'utf8')).replace('"schemaVersion": "1.2"', '"schemaVersion": "9.0"'),
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
