import { describe, expect, it } from 'vitest';
import { octiconSvg, type OcticonName } from '../../src/lib/octicon';
import { SYMBOL_ICON } from '../../src/lib/symbols';

describe('octiconSvg', () => {
  it('is decorative without a label', () => {
    const svg = octiconSvg('check');
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('fill="currentColor"');
    expect(svg).not.toContain('role="img"');
  });

  it('is a labelled image with a label', () => {
    const svg = octiconSvg('check', { label: 'Pass' });
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Pass"');
    expect(svg).not.toContain('aria-hidden');
  });

  it('escapes the label', () => {
    expect(octiconSvg('check', { label: 'a "b" <c>' })).toContain(
      'aria-label="a &quot;b&quot; &lt;c&gt;"',
    );
  });

  it('defaults to 16px and honours size 24 and a class', () => {
    expect(octiconSvg('check')).toContain('width="16"');
    const svg = octiconSvg('check', { size: 24, className: 'icon icon--green' });
    expect(svg).toContain('width="24"');
    expect(svg).toContain('height="24"');
    expect(svg).toMatch(/class="octicon octicon-check icon icon--green"/);
  });

  it('knows every symbol icon', () => {
    for (const name of Object.values(SYMBOL_ICON)) expect(() => octiconSvg(name)).not.toThrow();
  });

  it('throws on an unknown name', () => {
    expect(() => octiconSvg('no-such-icon' as OcticonName)).toThrow(/no-such-icon/);
  });
});
