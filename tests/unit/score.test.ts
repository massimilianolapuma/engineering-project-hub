import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import {
  PoliciesSchema,
  type Dimension,
  type HealthResult,
  type HealthStatus,
  type ReasonCode,
} from '@model/index';
import { evaluateScore, NOT_APPLICABLE_REASON_CODES } from '../../collector/src/evaluators/score';
import { scoreSortKey } from '../../src/lib/score';

const P = PoliciesSchema.parse(parse(readFileSync('config/policies.yaml', 'utf8')));

type Dims = [HealthStatus, HealthStatus, HealthStatus, HealthStatus, HealthStatus];
const ORDER: Dimension[] = ['delivery', 'version', 'security', 'coverage', 'governance'];

const result = (status: HealthStatus, code?: ReasonCode): HealthResult => ({
  status,
  reasons: code ? [{ code, level: status === 'green' ? 'info' : status, params: {} }] : [],
});

/**
 * Builds the five dimensions in order: delivery, version, security, coverage, governance.
 * Quality (optional) is grey (no report) unless overridden.
 */
function dims(
  statuses: Dims,
  overrides: Partial<Record<Dimension, HealthResult>> = {},
): Record<Dimension, HealthResult> {
  const out = {} as Record<Dimension, HealthResult>;
  ORDER.forEach((d, i) => {
    const s = statuses[i]!;
    out[d] =
      overrides[d] ?? result(s, s === 'grey' ? 'required-control-not-authorised' : undefined);
  });
  out.quality = overrides.quality ?? result('grey', 'quality-report-missing');
  return out;
}

describe('project score', () => {
  it('scores the mock projects', () => {
    expect(evaluateScore(dims(['red', 'amber', 'red', 'amber', 'amber']), 'red', P)).toEqual({
      value: 38,
      measured: 5,
      required: 5,
    });
    expect(evaluateScore(dims(['green', 'amber', 'amber', 'amber', 'green']), 'amber', P)).toEqual({
      value: 76,
      measured: 5,
      required: 5,
    });
    expect(evaluateScore(dims(['green', 'green', 'amber', 'green', 'green']), 'amber', P)).toEqual({
      value: 88,
      measured: 5,
      required: 5,
    });
    expect(evaluateScore(dims(['grey', 'grey', 'grey', 'grey', 'grey']), 'grey', P)).toEqual({
      value: null,
      measured: 0,
      required: 5,
    });
  });

  it('caps red overall at 49', () => {
    const s = evaluateScore(dims(['green', 'green', 'red', 'green', 'green']), 'red', P);
    expect(s).toEqual({ value: 49, measured: 5, required: 5 });
  });

  it('caps grey overall at 89', () => {
    const s = evaluateScore(dims(['green', 'green', 'green', 'grey', 'green']), 'grey', P);
    expect(s).toEqual({ value: 89, measured: 4, required: 5 });
  });

  it('healthy project scores 100', () => {
    const s = evaluateScore(dims(['green', 'green', 'green', 'green', 'green']), 'green', P);
    expect(s).toEqual({ value: 100, measured: 5, required: 5 });
  });

  it('not applicable is excluded from confidence', () => {
    expect(NOT_APPLICABLE_REASON_CODES).toContain('no-critical-workflows');
    const s = evaluateScore(
      dims(['grey', 'green', 'green', 'green', 'green'], {
        delivery: result('grey', 'no-critical-workflows'),
      }),
      'grey',
      P,
    );
    expect(s).toEqual({ value: 89, measured: 4, required: 4 });
  });

  it('grey for another reason next to not applicable still counts as not measured', () => {
    const delivery: HealthResult = {
      status: 'grey',
      reasons: [
        { code: 'no-critical-workflows', level: 'grey', params: {} },
        { code: 'workflow-data-unavailable', level: 'grey', params: {} },
      ],
    };
    const s = evaluateScore(
      dims(['grey', 'green', 'green', 'green', 'green'], { delivery }),
      'grey',
      P,
    );
    expect(s).toEqual({ value: 89, measured: 4, required: 5 });
  });

  it('insufficient data below half', () => {
    expect(evaluateScore(dims(['green', 'green', 'grey', 'grey', 'grey']), 'grey', P)).toEqual({
      value: null,
      measured: 2,
      required: 5,
    });
    const three = evaluateScore(dims(['green', 'green', 'amber', 'grey', 'grey']), 'amber', P);
    expect(three.measured).toBe(3);
    expect(typeof three.value).toBe('number');
  });

  it('grey optional quality does not change value, measured or required', () => {
    const five = ['green', 'amber', 'amber', 'amber', 'green'] as Dims;
    const expected = { value: 76, measured: 5, required: 5 };
    expect(evaluateScore(dims(five), 'amber', P)).toEqual(expected);
    for (const quality of [
      result('grey', 'quality-report-not-authorised'),
      result('grey', 'quality-not-applicable'),
      { status: 'grey', reasons: [] } as HealthResult,
    ]) {
      expect(evaluateScore(dims(five, { quality }), 'amber', P)).toEqual(expected);
    }
  });

  it('measured quality counts with weight 10', () => {
    const five = ['green', 'amber', 'amber', 'amber', 'green'] as Dims;
    // 25·100 + 15·60 + 30·60 + 15·60 + 15·100 + 10·20 = 7800 / 110 = 70.9
    expect(evaluateScore(dims(five, { quality: result('red') }), 'amber', P)).toEqual({
      value: 71,
      measured: 6,
      required: 6,
    });
    // … + 10·100 = 8600 / 110 = 78.2
    expect(evaluateScore(dims(five, { quality: result('green') }), 'amber', P)).toEqual({
      value: 78,
      measured: 6,
      required: 6,
    });
  });

  it('only counts required dimensions', () => {
    const p = PoliciesSchema.parse({
      ...P,
      overall: { ...P.overall, requiredDimensions: ['delivery', 'version', 'security'] },
    });
    const s = evaluateScore(dims(['green', 'green', 'amber', 'red', 'red']), 'amber', p);
    // delivery 25·100 + version 15·100 + security 30·60 = 5800 / 70 = 82.857…
    expect(s).toEqual({ value: 83, measured: 3, required: 3 });
  });

  it('uses configured weights', () => {
    const custom = PoliciesSchema.parse({
      ...P,
      score: {
        weights: { delivery: 0, version: 0, security: 100, coverage: 0, governance: 0, quality: 0 },
      },
    });
    expect(
      evaluateScore(dims(['green', 'green', 'amber', 'green', 'green']), 'amber', custom).value,
    ).toBe(60);
    expect(evaluateScore(dims(['red', 'red', 'green', 'red', 'red']), 'red', custom).value).toBe(
      49,
    );
  });

  it('defaults the score block when policies.yaml omits it', () => {
    const { score: _omit, ...rest } = P;
    const p = PoliciesSchema.parse(rest);
    expect(p.score).toEqual({
      weights: {
        delivery: 25,
        version: 15,
        security: 30,
        coverage: 15,
        governance: 15,
        quality: 10,
      },
      points: { green: 100, amber: 60, red: 20 },
      caps: { red: 49, amber: 89, grey: 89 },
      minMeasuredRatio: 0.5,
    });
  });

  it('rejects unknown keys in the score block', () => {
    expect(() => PoliciesSchema.parse({ ...P, score: { bonus: 1 } })).toThrow();
  });
});

describe('portfolio score sort key', () => {
  type Row = { name: string; score: { value: number | null } };
  const order = (rows: Row[]) =>
    [...rows]
      .sort((a, b) => scoreSortKey(a.score) - scoreSortKey(b.score) || a.name.localeCompare(b.name))
      .map((r) => r.name);

  it('sorts insufficient data right after red projects', () => {
    const rows: Row[] = [
      { name: 'Platform', score: { value: 88 } },
      { name: 'Healthy', score: { value: 100 } },
      { name: 'Gamma', score: { value: null } },
      { name: 'Alpha', score: { value: 76 } },
      { name: 'Beta', score: { value: 38 } },
      { name: 'Red at cap', score: { value: P.score.caps.red } },
      { name: 'Amber floor', score: { value: P.score.caps.red + 1 } },
    ];
    expect(order(rows)).toEqual([
      'Beta',
      'Red at cap',
      'Gamma',
      'Amber floor',
      'Alpha',
      'Platform',
      'Healthy',
    ]);
  });

  it('never treats insufficient data as zero', () => {
    expect(scoreSortKey({ value: null })).toBeGreaterThan(P.score.caps.red);
    expect(scoreSortKey({ value: 0 })).toBe(0);
  });
});
