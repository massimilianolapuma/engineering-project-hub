import { readFileSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'astro';
import { parse } from 'yaml';
import { PoliciesSchema } from '@model/index';
import { scan } from '../../scripts/scan-output';
import { en } from '../../src/i18n/en';
import { it as itDict } from '../../src/i18n/it';

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
/** Text as Astro escapes it in HTML. */
const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

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
  'how-to-read',
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

  it.each([
    ['how-to-read', en],
    ['it/how-to-read', itDict],
  ] as const)('explains states, symbols, unknowns, score and thresholds on /%s', async (v, d) => {
    const html = await page(v);
    const policies = PoliciesSchema.parse(parse(readFileSync('config/policies.yaml', 'utf8')));
    const h = d.howToRead;
    expect(html).toMatch(new RegExp(`<h1[^>]*>${esc(h.title)}</h1>`));
    // Four states, each a dot with its label (text + shape, never colour alone).
    for (const s of ['red', 'amber', 'green', 'grey'] as const) {
      expect(html).toMatch(new RegExp(`data-state-row="${s}"[\\s\\S]*?class="dot dot--${s}"`));
      expect(html).toContain(esc(d.status[s]));
    }
    // Six control symbols with their meanings.
    for (const key of ['ok', 'gap', 'stale', 'failed', 'blind', 'na'] as const) {
      expect(html).toMatch(new RegExp(`data-symbol="${key}"[\\s\\S]*?class="sym sym--`));
      expect(html).toContain(esc(d.symbols[key]));
      expect(html).toContain(esc(h.symbolsHelp[key]));
    }
    // Unknown, not authorised, not configured and not applicable are four different things.
    for (const t of ['unknown', 'not-authorised', 'not-configured', 'not-applicable'] as const) {
      expect(html).toContain(`data-term="${t}"`);
      expect(html).toContain(esc(d.controlState[t]));
    }
    // Score formula: weights, points, caps and minimum measured ratio from the policies.
    const { weights, points, caps, minMeasuredRatio } = policies.score;
    expect(weights).toEqual({
      delivery: 25,
      version: 15,
      security: 30,
      coverage: 15,
      governance: 15,
    });
    expect(caps).toEqual({ red: 49, amber: 89, grey: 89 });
    expect(minMeasuredRatio).toBe(0.5);
    const cell = (attr: string, value: number | string) =>
      expect(html).toMatch(new RegExp(`${attr}[^>]*>\\s*${value}\\s*<`));
    for (const [dim, w] of Object.entries(weights)) cell(`data-weight="${dim}"`, w);
    for (const [st, p] of Object.entries(points)) cell(`data-points="${st}"`, p);
    for (const [st, c] of Object.entries(caps)) cell(`data-cap="${st}"`, c);
    cell('data-min-measured', `${minMeasuredRatio * 100}%`);
    // Thresholds summarised from policies.yaml.
    const fr = policies.freshness;
    cell('data-threshold="snapshotStaleHours"', fr.snapshotStaleHours);
    cell('data-threshold="workflowRunStaleDays"', fr.workflowRunStaleDays);
    cell('data-threshold="securityScanStaleDays"', fr.securityScanStaleDays);
    cell('data-threshold="securityStatusFileStaleDays"', fr.securityStatusFileStaleDays);
    cell('data-threshold="queuedThresholdMinutes"', policies.delivery.queuedThresholdMinutes);
    cell('data-threshold="greenThresholdPercent"', `${policies.coverage.greenThresholdPercent}%`);
    // Link to the configuration docs in the page language.
    expect(html).toContain(
      v.startsWith('it') ? 'docs/it/configuration.md' : 'docs/configuration.md',
    );
    const { findings } = await scan([join(dist, v)]);
    expect(findings).toEqual([]);
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
