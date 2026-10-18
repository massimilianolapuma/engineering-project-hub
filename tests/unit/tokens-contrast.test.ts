import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * WCAG AA contrast of the design tokens (src/styles/tokens.css), in both themes. Status
 * colours are checked on the sheet surface and on their own tinted ground (color-mix of the
 * status colour into the surface), because that is where the portfolio sheet draws them.
 */
const css = readFileSync('src/styles/tokens.css', 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) vars[m[1]!] = m[2]!;
  return vars;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map(lin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
/** color-mix(in srgb, fg pct%, bg) */
const mix = (fg: string, pct: number, bg: string) => {
  const f = rgb(fg);
  const b = rgb(bg);
  return (
    '#' +
    f
      .map((c, i) => Math.round(c * pct + b[i]! * (1 - pct)))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  );
};

const light = block(':root {');
const dark = { ...light, ...block(":root[data-theme='dark']") };
const tint = { light: 0.13, dark: 0.16 };

describe.each([
  ['light', light, tint.light],
  ['dark', dark, tint.dark],
] as const)('%s theme tokens', (_name, t, pct) => {
  it.each(['text', 'text-muted', 'text-tertiary', 'link', 'frame'])(
    '%s reaches 4.5:1 on surface and page background',
    (k) => {
      expect(contrast(t[k]!, t.surface!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t[k]!, t.bg!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t[k]!, t['surface-2']!)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(['red', 'amber', 'green', 'grey', 'sev-high'])(
    '%s reaches 4.5:1 on surface and on its own tint',
    (k) => {
      expect(contrast(t[k]!, t.surface!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t[k]!, mix(t[k]!, pct, t.surface!))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(['red', 'amber', 'green'])('body text stays readable on the %s cell tint', (k) => {
    const ground = mix(t[k]!, pct, t.surface!);
    expect(contrast(t.text!, ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['text-muted']!, ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.link!, ground)).toBeGreaterThanOrEqual(4.5);
  });
});
