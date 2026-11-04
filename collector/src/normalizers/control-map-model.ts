import type { ControlMap, ControlMapSummary, Policies, ProjectSnapshot } from '@model/index';
import type { RawProjectData } from '../collectors/collect';
import { fail } from '../providers/types';
import { evaluateControlMap, type ControlMapExtras } from '../evaluators/control-map';
import { medianResolvedDays, workloadIdentityOf } from '../evaluators/control-map-sources';
import { deliveryMetrics } from '../evaluators/delivery-metrics';
import { recordError, type BuildContext } from './model';
import { parsedWorkflows } from './repository-controls-model';

/*
 * Maps the raw control map readings and the built project snapshot onto the evaluator's input
 * (spec 2026-11-04), records their collection errors, and evaluates the map.
 */

export function controlMapExtras(
  raw: RawProjectData,
  s: ProjectSnapshot,
  policies: Policies,
  now: Date,
  ctx: BuildContext,
): ControlMapExtras {
  const cm = raw.controlMap!;
  const unique = [...new Map(raw.repos.map((r) => [r.repository, r])).values()];

  const pushProtection = new Map(
    unique.map((r) => [r.repository, r.repo.ok ? (r.repo.data.pushProtection ?? null) : null]),
  );

  let environments: ControlMapExtras['environments'] = null;
  if (cm.environments?.ok) environments = cm.environments.data;
  else if (cm.environments) {
    recordError(
      ctx,
      raw.config.coordinator.repository,
      'coordinator',
      'github-environments',
      cm.environments,
    );
    if (cm.environments.error.classification === 'not-authorised') environments = 'not-authorised';
  }

  const withControls = unique.filter((r) => r.controls);
  const workloadIdentity = workloadIdentityOf(
    withControls.map((r) => parsedWorkflows(r.controls!).files),
  );

  let deploy: ControlMapExtras['deploy'] = null;
  if (cm.deploy) {
    const d = cm.deploy;
    if (d.error && d.repository)
      recordError(ctx, d.repository, undefined, 'deploy-signal', fail(d.error));
    const m = d.reason
      ? { frequencyPerWeek: null, leadHoursMedian: null, cfrPercent: null, ttrHoursMedian: null }
      : deliveryMetrics(d.events, d.signal, policies.controlMap.windows, now);
    deploy = {
      environment: d.environment,
      signal: d.signal,
      reason: d.reason,
      notes: d.notes,
      ...m,
    };
  }

  return {
    pushProtection,
    environments,
    resolvedMedianDays: medianResolvedDays(
      s.securityFindings,
      now,
      policies.controlMap.windows.trendDays,
    ),
    workloadIdentity,
    deploy,
  };
}

export function buildControlMap(
  raw: RawProjectData,
  s: ProjectSnapshot,
  policies: Policies,
  now: Date,
  ctx: BuildContext,
): ControlMap | null {
  if (!raw.controlMap) return null;
  return evaluateControlMap(
    { snapshot: s, project: raw.config, extras: controlMapExtras(raw, s, policies, now, ctx) },
    policies,
  );
}

export function controlMapSummary(map: ControlMap | null): ControlMapSummary | null {
  if (!map) return null;
  return {
    score: map.score,
    measured: map.measured,
    applicable: map.applicable,
    levels: Object.fromEntries(
      map.cells.map((c) => [c.check, c.state === 'not-applicable' ? 'n/a' : c.level]),
    ) as ControlMapSummary['levels'],
  };
}
