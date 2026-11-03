import { describe, expect, it } from 'vitest';
import { summariseSpdx } from '../../collector/src/normalizers/sbom';

interface Pkg {
  name?: string;
  id?: string;
  concluded?: string | null;
  declared?: string | null;
  purl?: string | null;
}

/** An SPDX 2.3 document built in the test: a root package the document DESCRIBES, then `pkgs`. */
function doc(pkgs: Pkg[], opts: { root?: boolean; spdxVersion?: string; created?: string } = {}) {
  const packages: Record<string, unknown>[] = [];
  const relationships: Record<string, unknown>[] = [];
  if (opts.root !== false) {
    packages.push({ SPDXID: 'SPDXRef-root', name: 'com.github.example-org/demo' });
    relationships.push({
      spdxElementId: 'SPDXRef-DOCUMENT',
      relationshipType: 'DESCRIBES',
      relatedSpdxElement: 'SPDXRef-root',
    });
  }
  pkgs.forEach((p, i) => {
    packages.push({
      SPDXID: p.id ?? `SPDXRef-p${i}`,
      name: p.name ?? `synthetic-${i}`,
      versionInfo: '1.0.0',
      ...(p.concluded !== undefined ? { licenseConcluded: p.concluded ?? 'NOASSERTION' } : {}),
      ...(p.declared !== undefined ? { licenseDeclared: p.declared ?? 'NOASSERTION' } : {}),
      ...(p.purl ? { externalRefs: [{ referenceType: 'purl', referenceLocator: p.purl }] } : {}),
    });
  });
  return {
    spdxVersion: opts.spdxVersion ?? 'SPDX-2.3',
    creationInfo: { created: opts.created ?? '2026-01-15T11:00:00Z' },
    packages,
    relationships,
  };
}
const mit = (n: number): Pkg[] => Array.from({ length: n }, () => ({ concluded: 'MIT' }));

describe('summariseSpdx', () => {
  it('excludes the DESCRIBES root package', () => {
    const s = summariseSpdx(doc(mit(3)), [])!;
    expect(s.packages).toBe(3);
    expect(s.format).toBe('spdx');
    expect(s.specVersion).toBe('2.3');
    expect(s.generatedAt).toBe('2026-01-15T11:00:00Z');
  });

  it('without a DESCRIBES relationship no package is excluded', () => {
    expect(summariseSpdx(doc(mit(3), { root: false }), [])!.packages).toBe(3);
  });

  it('unwraps the legacy { sbom: … } envelope', () => {
    expect(summariseSpdx({ sbom: doc(mit(2)) }, [])!.packages).toBe(2);
  });

  it('licenseConcluded NOASSERTION falls back to licenseDeclared MIT', () => {
    const s = summariseSpdx(doc([{ concluded: null, declared: 'MIT' }]), [])!;
    expect(s.licenses).toEqual([{ id: 'MIT', count: 1 }]);
    expect(s.withoutLicense).toBe(0);
  });

  it('both NOASSERTION (or missing) → withoutLicense', () => {
    const s = summariseSpdx(
      doc([{ concluded: null, declared: null }, {}, { concluded: 'NONE' }, { concluded: '' }]),
      [],
    )!;
    expect(s.withoutLicense).toBe(4);
    expect(s.licenses).toEqual([]);
  });

  it('top 10 + otherLicenses (12 distinct ids with counts 12…1)', () => {
    const pkgs = Array.from({ length: 12 }, (_, i) =>
      Array.from({ length: 12 - i }, () => ({ concluded: `Lic-${String(i).padStart(2, '0')}` })),
    ).flat();
    const s = summariseSpdx(doc(pkgs), [])!;
    expect(s.licenses).toHaveLength(10);
    expect(s.licenses[0]).toEqual({ id: 'Lic-00', count: 12 });
    expect(s.otherLicenses).toBe(3);
  });

  it('ties are ordered by id', () => {
    const s = summariseSpdx(doc([{ concluded: 'ISC' }, { concluded: 'BSD-2-Clause' }]), [])!;
    expect(s.licenses.map((l) => l.id)).toEqual(['BSD-2-Clause', 'ISC']);
  });

  it('LicenseRef-acme folds into LicenseRef-*', () => {
    const s = summariseSpdx(
      doc([{ concluded: 'LicenseRef-acme' }, { concluded: 'LicenseRef-other AND MIT' }]),
      [],
    )!;
    expect(s.licenses).toEqual([{ id: 'LicenseRef-*', count: 2 }]);
    expect(JSON.stringify(s)).not.toContain('acme');
  });

  it('"MIT AND (Apache-2.0 OR BSD-3-Clause)" is kept verbatim', () => {
    const expression = 'MIT AND (Apache-2.0 OR BSD-3-Clause)';
    expect(summariseSpdx(doc([{ concluded: expression }]), [])!.licenses).toEqual([
      { id: expression, count: 1 },
    ]);
  });

  it('"<script>" license counts in otherLicenses, not as a license id', () => {
    const s = summariseSpdx(doc([{ concluded: '<script>' }]), [])!;
    expect(s.licenses).toEqual([]);
    expect(s.otherLicenses).toBe(1);
    expect(s.withoutLicense).toBe(0);
  });

  it('ecosystems from purl: pkg:npm → npm, pkg:bitbucket → other, no purl → unknown', () => {
    const s = summariseSpdx(
      doc([
        { purl: 'pkg:npm/%40scope/a@1.0.0' },
        { purl: 'pkg:npm/b@1.0.0' },
        { purl: 'pkg:bitbucket/team/repo@1' },
        { purl: 'pkg:maven/org.example/c@1' },
        {},
      ]),
      [],
    )!;
    expect(s.ecosystems).toEqual([
      { id: 'npm', count: 2 },
      { id: 'maven', count: 1 },
      { id: 'other', count: 1 },
      { id: 'unknown', count: 1 },
    ]);
  });

  it('flagged counts GPL-3.0-only case-insensitively inside an expression', () => {
    const s = summariseSpdx(
      doc([
        { concluded: 'GPL-3.0-only' },
        { concluded: 'MIT OR gpl-3.0-only' },
        { concluded: 'MIT' },
        { concluded: 'GPL-3.0-or-later' },
      ]),
      ['GPL-3.0-only'],
    )!;
    expect(s.flagged).toBe(2);
    expect(summariseSpdx(doc(mit(2)), [])!.flagged).toBe(0);
  });

  it('spdxVersion "SPDX-3.0" or missing packages → null (invalid)', () => {
    expect(summariseSpdx(doc(mit(1), { spdxVersion: 'SPDX-3.0' }), [])).toBeNull();
    expect(summariseSpdx({ spdxVersion: 'SPDX-2.3' }, [])).toBeNull();
    expect(summariseSpdx({ spdxVersion: 'SPDX-2.3', packages: 'x' }, [])).toBeNull();
    expect(summariseSpdx(null, [])).toBeNull();
    expect(summariseSpdx('SPDX-2.3', [])).toBeNull();
  });

  it('an invalid creation date gives generatedAt null', () => {
    expect(summariseSpdx(doc(mit(1), { created: 'yesterday' }), [])!.generatedAt).toBeNull();
  });

  it('100001 packages → packages null, partial true', () => {
    const s = summariseSpdx(doc(mit(100_001)), [])!;
    expect(s.packages).toBeNull();
    expect(s.withoutLicense).toBeNull();
    expect(s.flagged).toBeNull();
    expect(s.partial).toBe(true);
    expect(summariseSpdx(doc(mit(100_000)), [])!.packages).toBe(100_000);
  });

  it('result JSON never contains a package name', () => {
    const s = summariseSpdx(
      doc([
        { name: 'synthetic-secret-internal-pkg', concluded: 'MIT', purl: 'pkg:npm/internal@1' },
        { name: 'synthetic-other', concluded: 'LicenseRef-acme-1' },
      ]),
      [],
    )!;
    const json = JSON.stringify(s);
    expect(json).not.toContain('synthetic-');
    expect(json).not.toContain('internal');
    expect(json).not.toContain('com.github');
  });
});
