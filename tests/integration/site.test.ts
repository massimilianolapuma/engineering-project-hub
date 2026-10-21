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
/** Text nodes of an HTML fragment, joined (for assertions on built markup, not sanitization). */
const textOf = (html: string) => html.split(/<[^>]*>/).join('');
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
  'changes',
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
    for (const label of ['Delivery', 'Version', 'Security risk', 'Controls coverage', 'Quality'])
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
    expect(row).toContain('2 collection errors');
    expect(row).not.toMatch(/>\s*0\s*</);
  });

  it('encodes each dimension bar by height as well as colour (WCAG 1.4.1)', async () => {
    const html = await page('');
    const bars = [
      ...html.matchAll(/class="dimbars__bar dimbars__bar--(\w+) dimbars__bar--h(\d)"[^>]*>/g),
    ];
    expect(bars.length).toBe(4 * 6);
    // Worse is taller: critical full height, attention 2/3, healthy 1/3; unknown full height,
    // dashed outline, no fill.
    const HEIGHT: Record<string, string> = { red: '3', amber: '2', green: '1', grey: '3' };
    for (const [tag, status, h] of bars) {
      expect(h, status).toBe(HEIGHT[status!]);
      expect(tag).toContain(`data-height="${HEIGHT[status!]}"`);
      expect(tag).toMatch(/role="img"[^>]*aria-label="[^"]+: [^"]+"/);
    }
    expect(new Set(bars.map((m) => m[1]))).toEqual(new Set(['red', 'amber', 'green', 'grey']));
    // "How to read" explains the encoding, with a sample hidden from assistive technology.
    const htr = await page('how-to-read');
    const note = /<p[^>]*data-bars-note[^>]*>[\s\S]*?<\/p>/.exec(htr)?.[0] ?? '';
    expect(note).toContain(
      'critical is a full-height bar, attention two thirds, healthy one third',
    );
    expect(note).toMatch(/class="dimbars dimbars--bars"[^>]*aria-hidden="true"/);
    expect(note).not.toContain('role="img"');
    expect(await page('it/how-to-read')).toContain('attenzione a due terzi, sano a un terzo');
  });

  it('puts the filters in one disclosure and names projects hidden for unknown counts', async () => {
    const html = await page('');
    expect(html).toMatch(
      /<details class="portfolio__filterbox disclosure"[^>]*data-filterbox[^>]*open[^>]*>\s*<summary[^>]*>Filters</,
    );
    const box = html.slice(html.indexOf('data-filterbox'), html.indexOf('data-results'));
    for (const name of ['q', 'health', 'bu', 'sort', 'lifecycle', 'severity'])
      expect(box, name).toContain(`name="${name}"`);
    const results = /<p[^>]*data-results[^>]*>/.exec(html)?.[0] ?? '';
    expect(results).toContain('data-unknown-one="{n} project with unknown counts not shown"');
    expect(results).toContain('data-unknown-other="{n} projects with unknown counts not shown"');
    const it = /<p[^>]*data-results[^>]*>/.exec(await page('it'))?.[0] ?? '';
    expect(it).toContain('data-unknown-one="{n} progetto con conteggi sconosciuti non mostrato"');
    expect(it).toContain('data-unknown-other="{n} progetti con conteggi sconosciuti non mostrati"');
  });

  it('keeps frame-ancestors out of the meta CSP (ignored there; sent as a header)', async () => {
    const html = await page('');
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('frame-ancestors');
    expect(readFileSync('public/_headers', 'utf8')).toContain("frame-ancestors 'none'");
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
    expect(beta.slice(0, beta.indexOf('>'))).toContain('data-score="40"');
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
      expect(head).toMatch(/class="score__value"[^>]*>40</);
      expect(head).toContain('measured 6 of 6');
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

    it('links the six dimension cards to their sections', async () => {
      const html = await page('projects/project-beta');
      const cards = [...html.matchAll(/<a[^>]*\bhref="#([\w-]+)"[^>]*\bdata-dimension="(\w+)"/g)];
      expect(cards.map((m) => m[2])).toEqual([
        'delivery',
        'version',
        'security',
        'coverage',
        'governance',
        'quality',
      ]);
      // Governance checks repository standards (standard workflows): not collection errors.
      expect(cards.map((m) => m[1])).toEqual([
        'workflows',
        'environments',
        'security',
        'coverage',
        'workflows',
        'quality',
      ]);
      for (const id of ['workflows', 'environments', 'security', 'coverage', 'quality'])
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

    it('leads with the cause and folds identical unknown rows when nothing is measured', async () => {
      const why = between(await page('projects/project-gamma'), 'id="h-why"', '</section>');
      // The cause comes first, then one line instead of a row per unknown dimension.
      expect(why.indexOf('data-why-cause')).toBeGreaterThan(-1);
      expect(why.indexOf('data-why-cause')).toBeLessThan(why.indexOf('data-all-unknown'));
      const visible = why.slice(0, why.indexOf('data-why-more'));
      expect(visible.match(/class="why__item"/g)).toHaveLength(1);
      expect(between(visible, 'data-all-unknown', '</li>')).toContain('All 6 dimensions unknown');
      // The single reasons stay one click away, never silently dropped.
      expect(why).toMatch(
        /<details class="why__more disclosure"[^>]*>\s*<summary[^>]*>Show 7 more reasons</,
      );
      expect(why).toContain('Repository not accessible');
      const it = between(await page('it/projects/project-gamma'), 'id="h-why"', '</section>');
      expect(it).toContain('Tutte le 6 dimensioni sconosciute');
      expect(it).toContain('Mostra altri 7 motivi');
    });

    it('a grey Quality adds no quality reason to the why box', async () => {
      const gamma = JSON.parse(
        readFileSync('fixtures/snapshots/projects/project-gamma.json', 'utf8'),
      ) as { qualityHealth: { status: string } };
      expect(gamma.qualityHealth.status).toBe('grey');
      const why = between(await page('projects/project-gamma'), 'id="h-why"', '</section>');
      expect(why).not.toContain('Quality report');
      expect(why).not.toContain('href="#quality"');
      const it = between(await page('it/projects/project-gamma'), 'id="h-why"', '</section>');
      expect(it).not.toContain('Report di qualità');
    });

    it('lists the reasons beyond the first five in a disclosure inside the why box', async () => {
      const why = between(await page('projects/project-beta'), 'id="h-why"', '</section>');
      const shown = why.slice(0, why.indexOf('data-why-more'));
      expect(shown.match(/class="why__item"/g)).toHaveLength(5);
      expect(shown).not.toContain('data-all-unknown');
      const more = between(why, 'data-why-more', '</details>');
      expect(more).toMatch(/<summary[^>]*>Show \d+ more reasons</);
      expect(more).toContain('2 open high alerts');
      expect(why).not.toContain('see the sections below');
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
      const rows = [...comps.matchAll(/<tr[^>]*data-component="(\w+)"[\s\S]*?<\/tr>/g)];
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
      expect(html).toContain('misurato 6 di 6');
      expect(html).toContain('Ambienti');
    });
  });

  describe('quality dimension', () => {
    const between = (html: string, from: string, to: string) =>
      html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));
    const section = (html: string) => {
      const start = html.search(/<section[^>]*\bid="quality"/);
      expect(start, 'section#quality').toBeGreaterThan(-1);
      return html.slice(start, html.indexOf('</section>', start));
    };

    it('project-beta page has #quality with its percentage and "Does not mean 0%."', async () => {
      const html = await page('projects/project-beta');
      const q = section(html);
      expect(q).toMatch(/<h2[^>]*>Code quality</);
      expect(textOf(q)).toMatch(/67(\.2)?%/);
      expect(textOf(q)).toContain('Does not mean 0%.');
      // The blind spot is named; the not-applicable chart reads "–", never 0%.
      expect(between(q, 'data-quality-component="web"', '</tr>')).toContain('Not visible');
      expect(between(q, 'data-quality-component="helm"', '</tr>')).toContain('–');
      expect(between(q, 'data-quality-component="helm"', '</tr>')).not.toMatch(/\b0%/);
      // Findings are informative counts from GitHub Code Quality, with no link to a page there.
      expect(textOf(q)).toContain('1 reliability');
      expect(textOf(q)).toContain('9 maintainability');
      expect(q).not.toMatch(/href="[^"]*code-quality/);
      // The card line on the dimension card.
      expect(between(html, 'data-dimension="quality"', '</a>')).toContain(
        'Tests: 67.2% of lines · threshold 80%',
      );
      const it = section(await page('it/projects/project-beta'));
      expect(it).toMatch(/<h2[^>]*>Qualità del codice</);
      expect(textOf(it)).toContain('67,2%');
      expect(textOf(it)).toContain('Non significa 0%.');
    });

    it('never shows an unmeasured project as 0% or "0 of 0 lines"', async () => {
      const q = section(await page('projects/project-gamma'));
      // "Does not mean 0%." and "never 0%" are the only 0% allowed.
      const text = textOf(q).replace(/(does not mean|never) 0%/gi, '');
      expect(text).not.toMatch(/(^|[^\d,.])0(\.0)?%/);
      expect(text).not.toMatch(/\b0 of 0\b/);
      expect(q).toMatch(
        /class="[^"]*\bqsym\b[^"]*"[^>]*role="img"[^>]*aria-label="[^"]+"[^>]*>\s*\?/,
      );
      expect(q).toMatch(/class="meter meter--unknown"/);
    });

    it('marks a stale shared report with its age and the shared-report note', async () => {
      const q = section(await page('projects/platform'));
      expect(textOf(q)).toContain('Shared repository report');
      expect(q).toContain('⧖');
      expect(q).toContain('href="https://github.com/example-org/platform-mono/actions/runs/9501"');
    });

    it('label "Controls coverage" present and "Security coverage" absent on EN pages; "Copertura controlli" on IT', async () => {
      for (const v of ['', 'security', 'how-to-read', 'projects/project-beta']) {
        const html = await page(v);
        expect(html, v).toContain('Controls coverage');
        expect(html, v).not.toMatch(/security coverage/i);
        const it = await page(`it/${v}`.replace(/\/$/, ''));
        expect(it, v).toContain('Copertura controlli');
        expect(it, v).not.toMatch(/copertura (di )?sicurezza/i);
      }
    });

    it('portfolio row has six dimension bars', async () => {
      const html = await page('');
      for (const row of html.match(/<tr[^>]*data-project[\s\S]*?<\/tr>/g) ?? []) {
        const dims = [...row.matchAll(/class="dimbars__bar [^"]*"[^>]*data-dimension="(\w+)"/g)];
        expect(dims.map((m) => m[1])).toEqual([
          'delivery',
          'version',
          'security',
          'coverage',
          'governance',
          'quality',
        ]);
      }
      expect(html).toMatch(/<abbr class="dimbars__label" title="Quality"/);
    });

    it('data-quality lists project-beta web as missing report', async () => {
      const html = await page('data-quality');
      const reports = html.slice(html.indexOf('id="h-quality-reports"'));
      expect(reports.indexOf('id="h-quality-reports"')).toBe(0);
      const row = between(reports, 'data-quality-report="project-beta:web"', '</li>');
      expect(row).toContain('Project Beta');
      expect(row).toContain('web');
      expect(row).toContain('Missing');
      expect(reports).toContain('data-quality-report="project-gamma:service"');
      // Readable and not-applicable reports are not listed.
      expect(reports).not.toContain('data-quality-report="project-beta:api"');
      expect(reports).not.toContain('data-quality-report="project-beta:helm"');
      expect(await page('it/data-quality')).toContain('Report di copertura non visibili');
    });

    it('percentages render with the number next to every meter', async () => {
      for (const v of [
        'projects/project-alpha',
        'projects/project-beta',
        'projects/platform',
        'projects/project-gamma',
        'it/projects/project-beta',
      ]) {
        const html = await page(v);
        const parts = html.split(/<span class="meter[ "]/);
        expect(parts.length, v).toBeGreaterThan(1);
        for (const before of parts.slice(0, -1)) {
          // The value (a percentage, or the "?" symbol) sits right before the meter.
          expect(before.slice(-400), v).toMatch(
            /class="qcov__value[^"]*"[^>]*>(?:\s*<[^>]+>)*\s*(\d+(?:[.,]\d)?%|\?)/,
          );
        }
        expect(html, v).toMatch(/<span class="meter[^"]*"[^>]*aria-hidden="true"/);
      }
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
    // Counts are incomplete, so each known total is a lower bound: "≥ n", read as "at least n".
    const values = [
      ...totals.matchAll(/data-severity="(\w+)"[^>]*>([\s\S]*?)<\/span>\s*<span class="muted"/g),
    ].map(([, k, v]) => `${k}=${textOf(v!).trim()}`);
    expect(values).toEqual([
      'critical=≥at least 1',
      'high=≥at least 4',
      'medium=≥at least 7',
      'low=≥at least 5',
    ]);
    expect(totals).toMatch(
      /<span aria-hidden="true"[^>]*>≥<\/span>\s*<span class="visually-hidden"[^>]*>at least </,
    );
    expect(totals).toContain('Incomplete counts');
    // The lead sentence agrees with the totals: a lower bound, never an exact count.
    expect(html).toContain('at least 1 open critical alert');
    const itHtml = await page('it/security');
    expect(itHtml).toMatch(/<span class="visually-hidden"[^>]*>almeno </);
    expect(itHtml).toContain('almeno 1 alert critico aperto');
    // One card per project, in the portfolio order (score, insufficient data right after red).
    const order = [...html.matchAll(/<article[^>]*data-project="([\w-]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['project-beta', 'project-gamma', 'project-alpha', 'platform']);
    const card = (id: string) => {
      const start = html.lastIndexOf('<article', html.indexOf(`data-project="${id}"`));
      return html.slice(start, html.indexOf('</article>', start));
    };
    expect(card('project-beta')).toContain('Controls coverage: 2 of 4 required');
    expect(card('project-beta')).toContain('Not authorised (403)');
    expect(card('project-beta')).toMatch(/data-state="stale"[\s\S]*?⧖[\s\S]*?Container scanning/);
    // Health is the shared status badge (health shape), alert severity the severity pill
    // (rising bars) and a blind spot the dashed unknown pill: three looks, never confused.
    expect(card('project-beta')).toMatch(
      /class="badge badge--red badge--sm"[^>]*>\s*<svg class="icon icon--red"/,
    );
    expect(card('project-beta')).toMatch(
      /class="pill pill--sev-critical"[^>]*>\s*<svg class="icon icon--sev-critical"/,
    );
    expect(card('project-beta')).toMatch(
      /class="pill pill--grey"[^>]*>\s*<svg class="icon icon--grey"[\s\S]*?Secret scanning alerts not visible/,
    );
    expect(html).not.toMatch(/class="pill pill--(unknown|red|amber|green)"/);
    expect(card('project-gamma')).toContain('does not mean zero alerts');
    expect(card('project-gamma')).toMatch(/class="[^"]*card--unknown/);
    expect(card('project-gamma')).not.toMatch(/data-count[^>]*>\s*0\s*</);
    // No full findings table; the portfolio coverage matrix is a closed, secondary section.
    expect(html).not.toContain('table--findings');
    expect(html).toMatch(
      /<details(?![^>]*\bopen\b)[^>]*>\s*<summary[^>]*>[\s\S]*?Coverage by repository and control[\s\S]*?<table/,
    );
    const it = await page('it/security');
    expect(it).toContain('Copertura controlli: 2 di 4 richiesti');
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
    expect(html).toMatch(/<details class="dq-run disclosure"(?![^>]*\bopen\b)[^>]*>\s*<summary/);
    expect(html.lastIndexOf('<section')).toBeLessThan(
      html.indexOf('<details class="dq-run disclosure"'),
    );
    expect(html).not.toContain('kpi__value');

    const it = await page('it/data-quality');
    expect(it).toMatch(/<h1[^>]*>Qualità dati<\/h1>/);
    expect(it).toContain('Cosa non abbiamo potuto leggere, per causa');
    expect(it).toContain('20 giorni');
  });

  describe('versions page', () => {
    const card = (html: string, id: string) => {
      const start = html.indexOf(`data-project="${id}"`);
      expect(start, id).toBeGreaterThan(-1);
      return html.slice(start, html.indexOf('</article>', start));
    };

    it('leads with one sentence and orders projects worst first', async () => {
      const html = await page('versions');
      expect(html).toContain(
        '2 projects have an environment behind · 1 declared version does not match · 1 project we cannot read',
      );
      const order = [...html.matchAll(/<article[^>]*data-project="([^"]+)"/g)].map((m) => m[1]);
      expect(order).toEqual(['project-beta', 'project-alpha', 'project-gamma', 'platform']);
      // The old full component and submodule tables are gone.
      expect(html).not.toContain('Manifest vs submodule');
    });

    it('shows Beta environments as a path with PROD behind and a "To check" table', async () => {
      const beta = card(await page('versions'), 'project-beta');
      expect(beta).toMatch(
        /data-env="DEV"[^>]*data-env-status="aligned"[\s\S]*data-env="UAT"[\s\S]*data-env="PROD"[^>]*data-env-status="behind"/,
      );
      expect(beta).toContain('Coordinator');
      expect(beta).toContain('from release manifest');
      expect(beta).toContain('To check');
      const table = beta.slice(beta.indexOf('<table'), beta.indexOf('</table>'));
      expect(table).toContain('API service');
      expect(table).toContain('Mismatch');
      expect(table).toContain('The manifest declares 3.2.0 but the coordinator still pins 3.1.0.');
      // The drift line would repeat the mismatch, so it is not shown.
      expect(table).not.toContain('In use: 3.1.0');
      // Stacked rows on phones keep their column labels.
      for (const label of ['Manifest', 'Submodule', 'Latest release', 'What is happening'])
        expect(table).toContain(`data-label="${label}"`);
      expect(table).toContain('tools/legacy-scripts');
      expect(table).toContain('Unmapped');
      expect(table).toMatch(/href="[^"]*\/catalog\/"/);
      // Aligned components are collapsed, not listed among the problems.
      expect(table).not.toContain('Web console');
      const details = beta.slice(beta.indexOf('<details'), beta.indexOf('</details>'));
      expect(details).toContain('2 aligned components');
      expect(details).toContain('Web console');
      expect(details).toContain('Helm deployment');
    });

    it('collapses Platform to a single line and shows Gamma as a dashed card with its cause', async () => {
      const html = await page('versions');
      const platform = card(html, 'platform');
      expect(platform).toContain('data-card="aligned"');
      expect(platform).not.toContain('<table');
      expect(platform).not.toContain('<details');
      expect(platform).toMatch(/DEV and PROD on[\s\S]*2026\.10\.1/);
      expect(platform).toContain('3 aligned components');
      const gamma = card(html, 'project-gamma');
      expect(gamma).toContain('data-card="unknown"');
      expect(gamma).toContain('Versions not readable');
      expect(gamma).toContain('Not found (404)');
      expect(gamma).toContain('Not authorised (401/403)');
      expect(gamma).toMatch(/href="[^"]*\/data-quality\/"/);
      expect(gamma).not.toContain('<table');
    });

    it('is in Italian on /it/versions', async () => {
      const html = await page('it/versions');
      expect(html).toContain('2 progetti hanno un ambiente indietro');
      expect(html).toContain('Da verificare');
      expect(html).toContain('2 componenti allineati');
      expect(html).toContain('Discorde');
      expect(html).toContain('Non ultima');
      expect(html).toContain('Non censito');
    });
  });

  it('ships no inline script (CSP script-src self) and no secret patterns', async () => {
    const html = await page('');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    const { findings } = await scan([dist]);
    expect(findings).toEqual([]);
  });

  describe('CSV exports', () => {
    const csv = (name: string) => readFile(join(dist, 'exports', name), 'utf8');

    it('portfolio.csv exists, starts with the BOM and the header', async () => {
      const text = await csv('portfolio.csv');
      expect(text.startsWith('\uFEFFproject_id,project_name,')).toBe(true);
      expect(text.split('\r\n').filter(Boolean)).toHaveLength(5);
      expect(text.endsWith('\r\n')).toBe(true);
      const beta = text.split('\r\n').find((r) => r.startsWith('project-beta,'))!;
      expect(beta).toContain(',amber,58,2026-01-14T12:00:00.000Z');
    });

    it('findings-summary.csv and versions.csv exist with their headers', async () => {
      expect((await csv('findings-summary.csv')).startsWith('\uFEFFproject_id,component_id,')).toBe(
        true,
      );
      expect((await csv('versions.csv')).startsWith('\uFEFFrow_type,project_id,item_id,')).toBe(
        true,
      );
    });

    it("no CSV cell begins with = + - @ unless prefixed by '", async () => {
      for (const name of ['portfolio.csv', 'findings-summary.csv', 'versions.csv']) {
        const rows = (await csv(name)).replace('\uFEFF', '').split('\r\n').filter(Boolean);
        for (const row of rows)
          for (const cell of row.split(',')) expect(cell).not.toMatch(/^[=+\-@]/);
      }
    });
  });

  describe('trend', () => {
    const rowOf = (html: string, name: string) => {
      const from = html.slice(html.indexOf(`data-name="${name}"`));
      return from.slice(0, from.indexOf('</tr>'));
    };

    it.each([
      ['', 'Trend'],
      ['it', 'Andamento'],
    ])('portfolio /%s has a Trend column header', async (v, label) => {
      const html = await page(v);
      expect(html).toMatch(
        new RegExp(`<th role="columnheader" scope="col"[^>]*>\\s*${label}\\s*</th>`),
      );
    });

    it('draws a sparkline with a text label and delta for project alpha', async () => {
      const row = rowOf(await page(''), 'project alpha');
      expect(row).toMatch(
        /<svg[^>]*role="img"[^>]*aria-label="Score up 14 points over 12 days \(13 collections\)"[\s\S]*?<path/,
      );
      expect(row).toContain('+14 · 12 d');
      // Direction is never colour alone: an arrow glyph comes with the number.
      expect(row).toMatch(/▲/);
      expect(rowOf(await page('it'), 'project alpha')).toContain(
        'Punteggio in aumento di 14 punti in 12 giorni (13 raccolte)',
      );
    });

    it('says "Not enough measured points" for gamma and draws no path', async () => {
      const row = rowOf(await page(''), 'project gamma');
      expect(row).toContain('Not enough measured points');
      expect(row).not.toContain('spark__line');
    });

    it('links to exports/portfolio.csv with a download attribute', async () => {
      const html = await page('');
      expect(html).toMatch(/<a[^>]*href="[^"]*exports\/portfolio\.csv"[^>]*download/);
      expect(html).toContain('Download CSV');
      expect(html).toContain('never 0');
      expect(await page('it')).toContain('Scarica CSV');
    });

    it('project alpha has #trend with a table of 13 rows and one unknown score', async () => {
      const html = await page('projects/project-alpha');
      const at = html.indexOf('id="trend"');
      expect(at).toBeGreaterThan(html.indexOf('class="dimcards"'));
      const block = html.slice(at, html.indexOf('</section>', at));
      expect(block).toMatch(/<details[^>]*>\s*<summary[^>]*>Show history as a table/);
      expect(block.match(/data-trend-row/g)).toHaveLength(13);
      const gap = block.slice(block.indexOf('2026-01-09'));
      const cells = gap.slice(0, gap.indexOf('</tr>'));
      expect(cells).toContain('unknown-value');
      expect(block).toContain('Gaps are collections where the score could not be measured');
      expect(block).toMatch(/role="img"[^>]*aria-label="[^"]*\d/);
      expect(block).toContain('changes/#p-project-alpha');
    });

    it('project platform has 10 rows: no invented points', async () => {
      const html = await page('projects/platform');
      const at = html.indexOf('id="trend"');
      expect(html.slice(at, html.indexOf('</section>', at)).match(/data-trend-row/g)).toHaveLength(
        10,
      );
    });

    it('IT project page shows the gap note in Italian', async () => {
      expect(await page('it/projects/project-alpha')).toContain('I vuoti sono raccolte');
    });

    it('renders portfolio and project pages without history.json and changes.json', async () => {
      const data = join(work, 'no-history');
      await cp('fixtures/snapshots', data, { recursive: true });
      await rm(join(data, 'history.json'));
      await rm(join(data, 'changes.json'));
      const out = join(work, 'dist-no-history');
      await buildSite(data, out);
      const home = await readFile(join(out, 'index.html'), 'utf8');
      expect(home).toContain('No history yet');
      expect(home).not.toContain('spark__line');
      const proj = await readFile(join(out, 'projects/project-alpha/index.html'), 'utf8');
      expect(proj).toContain('No history yet');
      expect(proj).not.toContain('data-trend-row');
    }, 180_000);
  });

  describe('what changed', () => {
    const navLinks = (html: string) => {
      const nav = /<nav class="mainnav"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
      return [...nav.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)].map((m) => textOf(m[1]!).trim());
    };
    const card = (html: string, id: string) => {
      const at = html.indexOf(`id="p-${id}"`);
      return html.slice(at, html.indexOf('</article>', at));
    };
    const text = (html: string) => textOf(html).replace(/\s+/g, ' ');

    it('lists "What changed" right after Portfolio, in both languages', async () => {
      expect(navLinks(await page(''))[1]).toBe('What changed');
      expect(navLinks(await page('it'))[1]).toBe('Cosa è cambiato');
      expect(navLinks(await page(''))[0]).toBe('Portfolio');
    });

    it('shows the five totals with their labels', async () => {
      const t = text(await page('changes'));
      expect(t).toContain(
        '4 status changes · 1 new and 1 resolved critical/high alerts · 1 version moves · 1 new collection errors',
      );
      expect(text(await page('it/changes'))).toContain(
        '4 cambi di stato · 1 alert critici/alti nuovi e 1 risolti · 1 versioni cambiate · 1 nuovi errori di raccolta',
      );
      expect(t).toContain('Compared with the collection of 14 Jan 2026');
      expect(t).toContain('Demo data: earlier collections are synthetic.');
    });

    it('puts project beta first with its status changes, new alert and partial note', async () => {
      const html = await page('changes');
      expect(html.indexOf('id="p-project-beta"')).toBeLessThan(
        html.indexOf('id="p-project-alpha"'),
      );
      const articles = [...html.matchAll(/<article[^>]*id="p-([\w-]+)"/g)].map((m) => m[1]);
      expect(articles[0]).toBe('project-beta');
      const beta = card(html, 'project-beta');
      for (const dim of ['Overall', 'Delivery', 'Security risk'])
        expect(text(beta)).toMatch(new RegExp(`${dim}:? .*Attention.*→.*Critical`));
      expect(text(beta)).toContain('58 → 40');
      expect(beta).toContain(
        'href="https://github.com/example-org/project-beta-api/security/code-scanning/3"',
      );
      expect(text(beta)).toContain('Details withheld');
      expect(text(beta)).toContain('Some alert sources could not be read in one of the two');
      expect(text(beta)).toContain('Secret scanning');
      expect(text(beta)).toContain('example-org/project-beta-web');
    });

    it('lists the version move and the resolved alert of project alpha', async () => {
      const alpha = card(await page('changes'), 'project-alpha');
      expect(text(alpha)).toContain('Frontend: 2.0.3 → 2.1.0');
      expect(text(alpha)).toContain('example-org/project-alpha-backend#code-scanning#9');
    });

    it('says "No changes." for platform and gamma', async () => {
      const html = await page('changes');
      expect(text(card(html, 'platform'))).toContain('No changes.');
      expect(text(card(html, 'project-gamma'))).toContain('No changes.');
      expect(text(card(html, 'project-alpha'))).not.toContain('No changes.');
    });

    it('shows the restore-failed sentence and never "No changes"', async () => {
      const data = join(work, 'changes-basis');
      await cp('fixtures/snapshots', data, { recursive: true });
      const file = join(data, 'changes.json');
      const json = JSON.parse(await readFile(file, 'utf8'));
      json.basis = { state: 'restore-failed', previousCollectedAt: null, synthetic: false };
      for (const p of json.projects) {
        p.previous = null;
        p.statusChanges = [];
        p.newFindings = [];
        p.resolvedFindings = [];
        p.versionMoves = [];
        p.newErrors = [];
      }
      json.totals = Object.fromEntries(Object.keys(json.totals).map((k) => [k, 0]));
      await writeFile(file, JSON.stringify(json));
      const out = join(work, 'dist-changes-basis');
      await buildSite(data, out);
      const html = await readFile(join(out, 'changes/index.html'), 'utf8');
      expect(text(html)).toContain(esc(en.changes.basis['restore-failed']));
      expect(text(html)).not.toContain('No changes.');
      expect(html).not.toContain('<article');
      const it = await readFile(join(out, 'it/changes/index.html'), 'utf8');
      expect(text(it)).toContain(esc(itDict.changes.basis['restore-failed']));
    }, 180_000);

    it('says so when changes.json is missing', async () => {
      const data = join(work, 'no-changes');
      await cp('fixtures/snapshots', data, { recursive: true });
      await rm(join(data, 'changes.json'));
      const out = join(work, 'dist-no-changes');
      await buildSite(data, out);
      const html = await readFile(join(out, 'changes/index.html'), 'utf8');
      expect(text(html)).toContain('No change data in this snapshot');
      expect(html).not.toContain('<article');
    }, 180_000);

    it('has a History card on data quality and a #trends section on how to read', async () => {
      const dq = text(await page('data-quality'));
      expect(dq).toContain('Demo history: 12 synthetic previous collections');
      expect(dq).toContain('up to 120 collections, at most 90 days');
      expect(text(await page('it/data-quality'))).toContain(
        'Storico demo: 12 raccolte precedenti sintetiche',
      );
      const htr = await page('how-to-read');
      const at = htr.indexOf('id="trends"');
      expect(at).toBeGreaterThan(-1);
      const section = text(htr.slice(at, htr.indexOf('</section>', at)));
      expect(section).toContain('never 0');
      expect(section).toContain('UTF-8');
      expect(section).toContain('up to 120 collections and at most 90 days');
      expect(text(await page('it/how-to-read'))).toContain('Andamento, cambiamenti e CSV');
    });

    it('links the CSV exports from security and versions', async () => {
      expect(await page('security')).toMatch(
        /<a[^>]*href="[^"]*exports\/findings-summary\.csv"[^>]*download[^>]*>\s*Alert summary \(CSV\)/,
      );
      expect(await page('versions')).toMatch(
        /<a[^>]*href="[^"]*exports\/versions\.csv"[^>]*download[^>]*>\s*Versions \(CSV\)/,
      );
      expect(await page('it/versions')).toContain('Versioni (CSV)');
    });
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
    expect(box).toMatch(/<details[^>]*class="ce-howto disclosure"/);
  });

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
      quality: 10,
    });
    expect(caps).toEqual({ red: 49, amber: 89, grey: 89 });
    expect(minMeasuredRatio).toBe(0.5);
    const cell = (attr: string, value: number | string) =>
      expect(html).toMatch(new RegExp(`${attr}[^>]*>\\s*${value}\\s*<`));
    for (const [dim, w] of Object.entries(weights)) cell(`data-weight="${dim}"`, w);
    // Quality is optional: its row says it counts only when measured.
    expect(html).toContain(esc(h.optional));
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
    // Snapshot staleness comes from the snapshot: said on the page. Fixtures and policies agree,
    // so neither the mismatch nor the defaults note is shown.
    expect(html).toContain(esc(h.staleSourceNote));
    expect(html).not.toContain('data-policies-mismatch');
    expect(html).not.toContain(esc(h.defaultsNote));
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
      (await readFile(idx, 'utf8')).replace('"schemaVersion": "1.4"', '"schemaVersion": "9.0"'),
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
