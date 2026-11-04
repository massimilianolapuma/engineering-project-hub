import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * Control map colour scale (spec 2026-11-04 §5.5): each level's text reaches WCAG AA (4.5:1) on
 * its background in both themes, and the scale is monotonic (each step further from the page
 * background than the one before), so the colour order reads as the level order.
 */
const THEMES = 'node_modules/@primer/primitives/dist/css/functional/themes';
const CSS = readFileSync('src/styles/global.css', 'utf8');

function vars(file: string): Record<string, string> {
  const css = readFileSync(`${THEMES}/${file}`, 'utf8');
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--([a-zA-Z0-9-]+):\s*([^;]+);/g))
    if (!(m[1]! in out)) out[m[1]!] = m[2]!.trim();
  return out;
}
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (hex: string) => {
  const h = /^#([0-9a-f]{6})$/i.exec(hex)![1]!;
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

/** The background and text tokens of each level rule in global.css. */
const levels = [0, 1, 2, 3, 4, 5].map((l) => {
  const rule = new RegExp(
    `\\[data-cm-level='${l}'\\] \\{\\s*background: var\\(--([a-z0-9-]+)\\);\\s*color: var\\(--([a-zA-Z-]+)\\);`,
  ).exec(CSS);
  if (!rule) throw new Error(`level ${l} rule not found`);
  return { bg: rule[1]!, fg: rule[2]! };
});

describe.each([
  ['light', vars('light.css')],
  ['dark', vars('dark.css')],
])('control map scale, %s theme', (_, v) => {
  it('every level number reaches 4.5:1 on its cell', () => {
    for (const l of levels) expect(ratio(v[l.bg]!, v[l.fg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it('steps move away from the page background in level order', () => {
    const page = v['bgColor-default']!;
    const distance = levels.map((l) => ratio(v[l.bg]!, page));
    for (let i = 1; i < distance.length; i++)
      expect(distance[i]!).toBeGreaterThan(distance[i - 1]!);
  });
});
