import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Guards the Primer migration (v0.10.0): src/ uses Primer functional tokens only. No Warm
 * Graphite token, no theme selector of the old mechanism, no colour literal in styles.
 */
const LEGACY =
  /var\(--(bg|surface|surface-2|border|border-strong|text|text-muted|unknown|accent|on-accent|accent-tint|(red|amber|green)(-text|-tint)?|space-\d|radius-(sm|md|lg|pill)|font-(sans|mono)|fs-[a-z]+)\)/;
/** The v0.9.0 theme mechanism (`data-theme` on <html>); the `data-theme-toggle` hook stays. */
const OLD_THEME = /\[data-theme[=\]]|\bdata-theme=|dataset\.theme\b/;
const LITERAL = /#[0-9a-f]{3,8}\b|oklch\(|rgba?\(/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk('src').filter((f) => /\.(astro|css|ts)$/.test(f));

/** The CSS a file carries: the whole file for .css, the <style> blocks for .astro. */
function styles(file: string): string {
  const text = readFileSync(file, 'utf8');
  if (file.endsWith('.css')) return text;
  if (file.endsWith('.astro'))
    return [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  return '';
}

/** Lines of `text` matching `re`, as "file:line: text" for a readable failure. */
function hits(file: string, text: string, re: RegExp): string[] {
  return text
    .split('\n')
    .flatMap((line, i) => (re.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []));
}

describe('Primer tokens only', () => {
  it('src uses no legacy Warm Graphite token', () => {
    const found = files.flatMap((f) => hits(f, readFileSync(f, 'utf8'), LEGACY));
    expect(found).toEqual([]);
  });

  it('src has no data-theme selector or attribute (Primer data-color-mode instead)', () => {
    const found = files.flatMap((f) => hits(f, readFileSync(f, 'utf8'), OLD_THEME));
    expect(found).toEqual([]);
  });

  it('src has no colour literals in styles (Primer tokens only)', () => {
    const found = files.flatMap((f) => hits(f, styles(f), LITERAL));
    expect(found).toEqual([]);
  });

  it('tokens.css imports Primer and keeps only --status-col', () => {
    const css = readFileSync('src/styles/tokens.css', 'utf8');
    for (const path of [
      'base/size/size.css',
      'base/typography/typography.css',
      'functional/size/size.css',
      'functional/size/radius.css',
      'functional/size/border.css',
      'functional/typography/typography.css',
      'functional/themes/light.css',
      'functional/themes/dark.css',
    ]) {
      expect(css).toContain(`@import '@primer/primitives/dist/css/${path}';`);
    }
    const defined = [...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]);
    expect(defined).toEqual(['--status-col']);
  });

  it('IBM Plex is gone', () => {
    expect(readFileSync('package.json', 'utf8')).not.toMatch(/ibm-plex/);
    const found = files.flatMap((f) => hits(f, readFileSync(f, 'utf8'), /ibm-plex|IBM Plex/));
    expect(found).toEqual([]);
  });
});
