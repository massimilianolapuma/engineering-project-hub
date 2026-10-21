import { describe, expect, it } from 'vitest';
import {
  ChangesFileSchema,
  HistoryFileSchema,
  type ChangesFile,
  type HistoryFile,
} from '@model/index';

const AT = '2026-01-15T12:00:00.000Z';

function validHistory(): HistoryFile {
  return {
    kind: 'hub-history',
    schemaVersion: '1.0',
    generatedAt: AT,
    retention: { maxEntries: 120, maxAgeDays: 90 },
    restore: { state: 'none', previousEntries: 0 },
    entries: [
      {
        collectedAt: AT,
        dataSource: 'mock',
        authenticationMode: 'mock',
        collectorVersion: '0.6.0',
        projects: [
          {
            id: 'project-alpha',
            overall: 'amber',
            score: 78,
            scoreMeasured: 6,
            scoreRequired: 6,
            dimensions: {
              delivery: 'green',
              version: 'green',
              security: 'amber',
              coverage: 'green',
              governance: 'green',
              quality: 'grey',
            },
            open: { critical: 0, high: 1, medium: null, low: 2 },
            countsComplete: true,
            collectionErrors: 0,
          },
        ],
      },
    ],
    baseline: {
      collectedAt: AT,
      projects: [
        {
          id: 'project-alpha',
          repositories: ['example-org/project-alpha-backend'],
          findings: [
            {
              id: 'example-org/project-alpha-backend#code-scanning#9',
              severity: 'high',
              componentId: 'backend',
              repository: 'example-org/project-alpha-backend',
              source: 'github-code-scanning',
              htmlUrl:
                'https://github.com/example-org/project-alpha-backend/security/code-scanning/9',
            },
          ],
          unreadable: [],
          versions: [{ kind: 'coordinator', componentId: null, version: '1.4.0' }],
          errors: [],
        },
      ],
    },
  };
}

const clone = <T>(v: T): T => structuredClone(v);

function validChanges(): ChangesFile {
  return {
    kind: 'hub-changes',
    schemaVersion: '1.0',
    generatedAt: AT,
    basis: { state: 'compared', previousCollectedAt: '2026-01-14T12:00:00.000Z', synthetic: false },
    totals: {
      statusChanges: 0,
      newFindings: 0,
      resolvedFindings: 0,
      versionMoves: 0,
      newErrors: 0,
    },
    projects: [
      {
        id: 'project-alpha',
        added: false,
        previous: { overall: 'amber', score: 76 },
        current: { overall: 'amber', score: 78 },
        statusChanges: [],
        newFindings: [],
        resolvedFindings: [],
        findingsTruncated: 0,
        findingsPartial: false,
        versionMoves: [],
        newErrors: [],
        resolvedErrors: 0,
      },
    ],
  };
}

describe('HistoryFileSchema', () => {
  it('accepts a minimal valid history file', () => {
    expect(HistoryFileSchema.safeParse(validHistory()).success).toBe(true);
  });

  it('rejects an extra key on an entry', () => {
    const f: unknown = clone(validHistory());
    (f as { entries: Record<string, unknown>[] }).entries[0]!.raw = {};
    expect(HistoryFileSchema.safeParse(f).success).toBe(false);
  });

  it('rejects kind "hub-changes" in HistoryFileSchema', () => {
    expect(HistoryFileSchema.safeParse({ ...validHistory(), kind: 'hub-changes' }).success).toBe(
      false,
    );
  });

  it('accepts schemaVersion "1.0" and "1.1", rejects "2.0"', () => {
    for (const v of ['1.0', '1.1'])
      expect(HistoryFileSchema.safeParse({ ...validHistory(), schemaVersion: v }).success).toBe(
        true,
      );
    expect(HistoryFileSchema.safeParse({ ...validHistory(), schemaVersion: '2.0' }).success).toBe(
      false,
    );
  });

  it('rejects a baseline whose collectedAt differs from the last entry', () => {
    const f = clone(validHistory());
    f.baseline.collectedAt = '2026-01-14T12:00:00.000Z';
    const r = HistoryFileSchema.safeParse(f);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('baseline must describe the latest entry');
  });

  it('rejects two entries with the same collectedAt', () => {
    const f = clone(validHistory());
    f.entries.push(clone(f.entries[0]!));
    const r = HistoryFileSchema.safeParse(f);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain(
      'entries must be strictly increasing by collectedAt',
    );
  });

  it('accepts a point without the quality dimension', () => {
    const f = clone(validHistory());
    delete f.entries[0]!.projects[0]!.dimensions.quality;
    expect(Object.keys(f.entries[0]!.projects[0]!.dimensions)).toHaveLength(5);
    expect(HistoryFileSchema.safeParse(f).success).toBe(true);
  });

  it('rejects score 101 and score -1; accepts score null', () => {
    const withScore = (score: number | null) => {
      const f = clone(validHistory());
      f.entries[0]!.projects[0]!.score = score;
      return HistoryFileSchema.safeParse(f).success;
    };
    expect(withScore(101)).toBe(false);
    expect(withScore(-1)).toBe(false);
    expect(withScore(null)).toBe(true);
  });

  it('rejects a project id with uppercase letters', () => {
    const f = clone(validHistory());
    f.entries[0]!.projects[0]!.id = 'Project-Alpha';
    expect(HistoryFileSchema.safeParse(f).success).toBe(false);
  });

  it('rejects a baseline htmlUrl with http://', () => {
    const f = clone(validHistory());
    f.baseline.projects[0]!.findings[0]!.htmlUrl = 'http://github.com/example-org/x/security/1';
    expect(HistoryFileSchema.safeParse(f).success).toBe(false);
  });
});

describe('ChangesFileSchema', () => {
  it('accepts basis.state "restore-failed" with previousCollectedAt null', () => {
    const f = validChanges();
    f.basis = { state: 'restore-failed', previousCollectedAt: null, synthetic: false };
    expect(ChangesFileSchema.safeParse(f).success).toBe(true);
  });

  it('rejects 51 newFindings for one project', () => {
    const f = validChanges();
    f.projects[0]!.newFindings = Array.from({ length: 51 }, (_, i) => ({
      id: `example-org/x#code-scanning#${i}`,
      severity: 'high' as const,
      componentId: 'backend',
      repository: 'example-org/x',
      title: null,
      htmlUrl: null,
    }));
    expect(ChangesFileSchema.safeParse(f).success).toBe(false);
    f.projects[0]!.newFindings.pop();
    expect(ChangesFileSchema.safeParse(f).success).toBe(true);
  });
});
