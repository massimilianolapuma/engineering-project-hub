import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * WCAG AA contrast of the Primer functional tokens the hub uses (@primer/primitives), in both
 * themes. Each theme file's first selector block is read, var(--x) references are resolved
 * inside it, and #rrggbbaa values are composited over the background they sit on (dark tints
 * are translucent), then measured with the WCAG relative luminance formula.
 */
const THEMES = 'node_modules/@primer/primitives/dist/css/functional/themes';

function firstBlock(file: string): Record<string, string> {
  const css = readFileSync(`${THEMES}/${file}`, 'utf8');
  const body = css.slice(css.indexOf('{') + 1, css.indexOf('}'));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-zA-Z0-9-]+):\s*([^;]+);/g)) vars[m[1]!] = m[2]!.trim();
  return vars;
}

type Rgba = [number, number, number, number];

/** Resolves a token to #rrggbb or #rrggbbaa through var() references in the same block. */
function resolve(vars: Record<string, string>, name: string, seen = new Set<string>()): string {
  const value = vars[name];
  if (value === undefined) throw new Error(`token not found: --${name}`);
  const ref = /^var\(--([a-zA-Z0-9-]+)\)$/.exec(value);
  if (!ref) return value;
  if (seen.has(name)) throw new Error(`cyclic token: --${name}`);
  return resolve(vars, ref[1]!, seen.add(name));
}

function rgba(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value);
  if (!hex) throw new Error(`unsupported colour value: ${value}`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16));
  return [r!, g!, b!, hex[2] ? parseInt(hex[2], 16) / 255 : 1];
}

/** `top` drawn over an opaque `under`. */
const over = (top: Rgba, under: Rgba): Rgba => [
  top[0] * top[3] + under[0] * (1 - top[3]),
  top[1] * top[3] + under[1] * (1 - top[3]),
  top[2] * top[3] + under[2] * (1 - top[3]),
  1,
];

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]: Rgba) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: Rgba, b: Rgba) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

const themes = { light: firstBlock('light.css'), dark: firstBlock('dark.css') };

describe.each(Object.entries(themes))('Primer tokens, %s theme', (_, vars) => {
  const c = (name: string) => rgba(resolve(vars, name));
  const page = c('bgColor-default');
  const backgrounds = { 'bgColor-default': page, 'bgColor-muted': over(c('bgColor-muted'), page) };

  /** Contrast of `fg` (composited over `bg`) against `bg`. */
  const check = (fg: string, bg: Rgba) => ratio(over(c(fg), bg), bg);

  it.each(['fgColor-default', 'fgColor-muted', 'fgColor-accent'])(
    '%s text reaches 4.5:1 on the page and muted backgrounds',
    (fg) => {
      for (const bg of Object.values(backgrounds))
        expect(check(fg, bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(['danger', 'attention', 'success', 'severe'])(
    'fgColor-%s text reaches 4.5:1 on its own muted tint',
    (tone) => {
      for (const bg of Object.values(backgrounds)) {
        const tint = over(c(`bgColor-${tone}-muted`), bg);
        expect(check(`fgColor-${tone}`, tint)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(['fgColor-danger', 'fgColor-attention', 'fgColor-success', 'borderColor-emphasis'])(
    '%s marks reach 3:1 (non-text contrast) on the page and muted backgrounds',
    (fg) => {
      for (const bg of Object.values(backgrounds)) expect(check(fg, bg)).toBeGreaterThanOrEqual(3);
    },
  );

  it('primary button text reaches 4.5:1 on the primary button', () => {
    const button = over(c('button-primary-bgColor-rest'), page);
    expect(check('button-primary-fgColor-rest', button)).toBeGreaterThanOrEqual(4.5);
  });
});
