import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * WCAG AA contrast of the Warm Graphite design tokens (src/styles/tokens.css), in both themes.
 * Tokens are written as hex or oklch(); oklch is converted to linear sRGB (OKLab matrices),
 * clamped to the sRGB gamut, then measured with the WCAG relative luminance formula.
 * Pill tints are fixed values (not color-mix) so they can be checked here.
 */
const css = readFileSync('src/styles/tokens.css', 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gi)) vars[m[1]!] = m[2]!.trim();
  return vars;
}

type Rgb = [number, number, number];

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Linear sRGB (0..1) of a hex (#rrggbb) or oklch(L C H) colour. */
function linearRgb(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    return [0, 2, 4].map((i) => srgbToLinear(parseInt(hex[1]!.slice(i, i + 2), 16) / 255)) as Rgb;
  }
  const ok = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/i.exec(value);
  if (ok) {
    const L = ok[2] === '%' ? Number(ok[1]) / 100 : Number(ok[1]);
    const C = Number(ok[3]);
    const h = (Number(ok[4]) * Math.PI) / 180;
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ];
  }
  throw new Error(`unsupported colour value: ${value}`);
}

const lum = (value: string) => {
  const [r, g, b] = linearRgb(value);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

const light = block(':root {');
const darkMedia = block(":root:not([data-theme='light'])");
const darkAttr = block(":root[data-theme='dark']");
const dark = { ...light, ...darkAttr };

const COLOUR_TOKENS = [
  'bg',
  'surface',
  'surface-2',
  'border',
  'border-strong',
  'text',
  'text-muted',
  'unknown',
  'accent',
  'on-accent',
  'accent-tint',
  'red',
  'red-text',
  'red-tint',
  'amber',
  'amber-text',
  'amber-tint',
  'green',
  'green-text',
  'green-tint',
] as const;

describe('token structure', () => {
  it.each(COLOUR_TOKENS)('light theme defines --%s as hex or oklch', (k) => {
    expect(light[k], `--${k}`).toBeDefined();
    expect(() => linearRgb(light[k]!)).not.toThrow();
  });

  it.each(COLOUR_TOKENS)('dark theme defines --%s in both dark selectors', (k) => {
    expect(darkAttr[k], `--${k}`).toBeDefined();
    expect(darkMedia[k]).toBe(darkAttr[k]);
  });

  it('defines radius, spacing and font tokens', () => {
    expect(light['radius-sm']).toBe('4px');
    expect(light['radius-md']).toBe('8px');
    expect(light['radius-lg']).toBe('10px');
    expect(light['radius-pill']).toBe('999px');
    expect([1, 2, 3, 4, 5, 6].map((i) => light[`space-${i}`])).toEqual([
      '4px',
      '8px',
      '12px',
      '16px',
      '24px',
      '32px',
    ]);
    expect(light['font-sans']).toContain('IBM Plex Sans');
    expect(light['font-mono']).toContain('IBM Plex Mono');
  });

  it('drops the survey sheet hatching and the old fonts', () => {
    expect(css).not.toMatch(/--hatch|--frame|public-sans|geist-mono|color-mix/);
  });
});

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s theme contrast', (_name, t) => {
  it.each(['text', 'text-muted', 'accent'])(
    '%s reaches 4.5:1 on surface, page background and surface-2',
    (k) => {
      expect(contrast(t[k]!, t.surface!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t[k]!, t.bg!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t[k]!, t['surface-2']!)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(['red', 'amber', 'green'])('%s-text reaches 4.5:1 on surface and on its tint', (k) => {
    expect(contrast(t[`${k}-text`]!, t.surface!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t[`${k}-text`]!, t[`${k}-tint`]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['red', 'amber', 'green', 'unknown', 'border-strong'])(
    '%s reaches 3:1 on surface as a graphic',
    (k) => {
      expect(contrast(t[k]!, t.surface!)).toBeGreaterThanOrEqual(3);
    },
  );

  it('on-accent reaches 4.5:1 on accent', () => {
    expect(contrast(t['on-accent']!, t.accent!)).toBeGreaterThanOrEqual(4.5);
  });

  it('text and accent stay readable on the accent tint (selected items)', () => {
    expect(contrast(t.text!, t['accent-tint']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.accent!, t['accent-tint']!)).toBeGreaterThanOrEqual(4.5);
  });
});
