import { describe, expect, it } from 'vitest';
import type { SecurityFinding } from '@model/index';
import { applySla, slaClassOf } from '../../collector/src/policy/sla';
import { NOW, policies } from '../helpers/factories';

type Input = SecurityFinding & {
  exception?: { id: string; state: 'active' | 'expired'; expires: string } | null;
};

function finding(over: Partial<Input> = {}): Input {
  return {
    id: 'example-org/platform-mono#code-scanning#2',
    projectId: 'platform',
    componentId: 'mono',
    repository: 'example-org/platform-mono',
    source: 'github-code-scanning',
    category: 'code',
    severity: 'high',
    originalSeverity: 'high',
    status: 'open',
    originalStatus: 'open',
    ruleId: null,
    title: null,
    detectedAt: '2025-12-15T18:00:00.000Z',
    updatedAt: null,
    fixAvailable: null,
    htmlUrl: null,
    tool: null,
    repositoryPrivate: false,
    dataClassification: 'public',
    ...over,
  };
}
const exc = (state: 'active' | 'expired') => ({ id: 'EXC-1', state, expires: '2026-02-01' });
const apply = (
  findings: Input[],
  over: (p: ReturnType<typeof policies>) => void = () => {},
  readable = true,
) => applySla(findings, policies(over), NOW, readable);

describe('applySla', () => {
  it('high detected 2025-12-15T18:00:00.000Z → overdue, days 30, dueAt 2026-01-14T18:00:00.000Z, ageDays 30, overdueDays 0', () => {
    expect(apply([finding()]).findings[0]!.sla).toEqual({
      state: 'overdue',
      days: 30,
      dueAt: '2026-01-14T18:00:00.000Z',
      ageDays: 30,
      overdueDays: 0,
    });
  });

  it('critical detected 2026-01-12T12:00:00.000Z → within, dueAt 2026-01-19T12:00:00.000Z, ageDays 3, overdueDays null', () => {
    const f = finding({ severity: 'critical', detectedAt: '2026-01-12T12:00:00.000Z' });
    expect(apply([f]).findings[0]!.sla).toEqual({
      state: 'within',
      days: 7,
      dueAt: '2026-01-19T12:00:00.000Z',
      ageDays: 3,
      overdueDays: null,
    });
  });

  it('high with exception active → paused, dueAt 2025-12-31T12:00:00.000Z, ageDays 45, overdueDays null (the clock is not reset)', () => {
    const f = finding({ detectedAt: '2025-12-01T12:00:00.000Z', exception: exc('active') });
    expect(apply([f]).findings[0]!.sla).toEqual({
      state: 'paused',
      days: 30,
      dueAt: '2025-12-31T12:00:00.000Z',
      ageDays: 45,
      overdueDays: null,
    });
  });

  it('same finding with exception expired → overdue, overdueDays 15', () => {
    const f = finding({ detectedAt: '2025-12-01T12:00:00.000Z', exception: exc('expired') });
    expect(apply([f]).findings[0]!.sla).toMatchObject({
      state: 'overdue',
      dueAt: '2025-12-31T12:00:00.000Z',
      overdueDays: 15,
    });
  });

  it('secret-scanning, severity unknown, detectedAt 2026-01-01T12:00:00.000Z → class secret, overdue (14 d > 7 d)', () => {
    const f = finding({
      source: 'github-secret-scanning',
      category: 'secret',
      severity: 'unknown',
      detectedAt: '2026-01-01T12:00:00.000Z',
    });
    expect(slaClassOf(f)).toBe('secret');
    expect(apply([f]).findings[0]!.sla).toMatchObject({ state: 'overdue', days: 7, ageDays: 14 });
  });

  it('secret-scanning detectedAt null → unknown, remediation.slaUnknown 1', () => {
    const f = finding({
      source: 'github-secret-scanning',
      severity: 'unknown',
      detectedAt: null,
    });
    const r = apply([f]);
    expect(r.findings[0]!.sla).toEqual({
      state: 'unknown',
      days: 7,
      dueAt: null,
      ageDays: null,
      overdueDays: null,
    });
    expect(r.remediation.slaUnknown).toBe(1);
  });

  it('informational → none; ageDays still set', () => {
    const f = finding({ severity: 'informational', detectedAt: '2026-01-10T12:00:00.000Z' });
    expect(slaClassOf(f)).toBeNull();
    expect(apply([f]).findings[0]!.sla).toEqual({
      state: 'none',
      days: null,
      dueAt: null,
      ageDays: 5,
      overdueDays: null,
    });
  });

  it('remediation.days.medium null → medium finding none', () => {
    const f = finding({ severity: 'medium' });
    const r = apply([f], (p) => {
      p.remediation.days.medium = null;
    });
    expect(r.findings[0]!.sla?.state).toBe('none');
    expect(r.remediation.slaDays.medium).toBeNull();
    expect(r.remediation.overdue.medium).toBe(0);
  });

  it('status fixed → sla null; external findings → sla null', () => {
    const r = apply([
      finding({ status: 'fixed' }),
      finding({ id: 'x', source: 'security-status-file' }),
    ]);
    expect(r.findings.map((f) => f.sla)).toEqual([null, null]);
  });

  it('remediation.enabled false → every sla null; overdue all null; slaUnknown 0', () => {
    const r = apply([finding(), finding({ detectedAt: null, id: 'y' })], (p) => {
      p.remediation.enabled = false;
    });
    expect(r.findings.map((f) => f.sla)).toEqual([null, null]);
    expect(r.remediation).toMatchObject({
      enabled: false,
      overdue: { critical: null, high: null, medium: null, low: null, secret: null },
      slaUnknown: 0,
      oldestOverdueSince: null,
    });
  });

  it('anyAlertSourceReadable false → overdue all null', () => {
    const r = apply([], () => {}, false);
    expect(r.remediation.overdue).toEqual({
      critical: null,
      high: null,
      medium: null,
      low: null,
      secret: null,
    });
    expect(r.remediation.enabled).toBe(true);
  });

  it('overdue counts exclude paused findings; oldestOverdueSince is the earliest dueAt', () => {
    const r = apply([
      finding({ id: 'a' }),
      finding({ id: 'b', detectedAt: '2025-12-01T12:00:00.000Z' }),
      finding({ id: 'c', detectedAt: '2025-11-01T12:00:00.000Z', exception: exc('active') }),
    ]);
    expect(r.remediation.overdue.high).toBe(2);
    expect(r.remediation.oldestOverdueSince).toBe('2025-12-31T12:00:00.000Z');
  });

  it('slaDays echoes { critical: 7, high: 30, medium: 90, low: 180, secret: 7 }', () => {
    expect(apply([]).remediation.slaDays).toEqual({
      critical: 7,
      high: 30,
      medium: 90,
      low: 180,
      secret: 7,
    });
  });

  it('keeps every other field of the finding', () => {
    const f = finding();
    expect(apply([f]).findings[0]).toMatchObject({ ...f });
  });
});
