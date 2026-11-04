import {
  CHECK_IDS,
  CONTROL_AREAS,
  CONTROL_CHECKS,
  type CheckId,
  type ControlCell,
  type ControlMap,
  type ControlReason,
  type ControlId,
  type Level,
  type Policies,
  type ProjectConfig,
  type ProjectSnapshot,
} from '@model/index';
import { levelFor } from './control-map-ladders';

/*
 * Control map evaluator (spec §5.2–§5.4). Pure: the project snapshot, its catalog entry and the
 * readings of the new sources (extras) in, 25 cells and a score out. Unknown is never 0: an
 * unreadable source is "not visible"; "% of repositories" checks use the readable repositories
 * only, and refuse when fewer than half could be read. Not applicable only when there is nothing
 * to check, or the catalog says so with a reason.
 */

type DeploySignalType = 'workflow' | 'versions-file' | 'argocd' | 'release' | 'external';

/** Readings of the new sources (Tasks 3–4); null = not collected. */
export interface ControlMapExtras {
  /** Push protection per unique repository; null when not read at all. */
  pushProtection: Map<string, 'enabled' | 'disabled' | null> | null;
  /** GitHub environments of the coordinator; null not read, 'not-authorised' on 403. */
  environments:
    { name: string; protected: boolean; branchPolicy: boolean }[] | null | 'not-authorised';
  /** Median days to close critical/high alerts closed in the trend window. */
  resolvedMedianDays: number | null;
  /** Deploying workflows and how many authenticate with OIDC; null when not read. */
  workloadIdentity: { deploying: number; oidc: number } | null;
  /** Delivery metrics on the delivery environment; null when not collected. */
  deploy: {
    environment: string;
    signal: DeploySignalType;
    reason: ControlReason | null;
    frequencyPerWeek: number | null;
    leadHoursMedian: number | null;
    cfrPercent: number | null;
    ttrHoursMedian: number | null;
    notes: string[];
  } | null;
}

export const emptyExtras = (): ControlMapExtras => ({
  pushProtection: null,
  environments: null,
  resolvedMedianDays: null,
  workloadIdentity: null,
  deploy: null,
});

export interface ControlMapInput {
  snapshot: ProjectSnapshot;
  project: ProjectConfig;
  extras: ControlMapExtras;
}

type RepoState = 'pass' | 'fail' | 'unknown' | 'n/a';

/** % of passing over readable items; null when fewer than half are readable or there are none. */
export function ratioOverReadable(states: readonly RepoState[]): {
  value: number | null;
  readable: { k: number; n: number };
  reason: ControlReason | null;
} {
  const applicable = states.filter((s) => s !== 'n/a');
  const n = applicable.length;
  const known = applicable.filter((s) => s === 'pass' || s === 'fail');
  const k = known.length;
  if (n === 0) return { value: null, readable: { k: 0, n: 0 }, reason: 'no-object' };
  if (k < n / 2) return { value: null, readable: { k, n }, reason: 'too-few-readable' };
  const pass = known.filter((s) => s === 'pass').length;
  return { value: Math.round((pass / k) * 1000) / 10, readable: { k, n }, reason: null };
}

export function scoreOf(cells: readonly Pick<ControlCell, 'level' | 'state'>[]): {
  score: number | null;
  measured: number;
  applicable: number;
} {
  const applicable = cells.filter((c) => c.state !== 'not-applicable');
  const known = applicable.filter((c) => c.level !== null);
  const measured = known.length;
  if (measured === 0 || measured < applicable.length / 2)
    return { score: null, measured, applicable: applicable.length };
  const mean = known.reduce((a, c) => a + (c.level as number), 0) / measured;
  return { score: Math.round(mean * 20), measured, applicable: applicable.length };
}

/** Median of the known levels of each check across projects (half rounds down). */
export function businessUnitMedian(
  rows: readonly (readonly Pick<ControlCell, 'level'>[])[],
): (Level | null)[] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  return Array.from({ length: width }, (_, i) => {
    const levels = rows
      .map((r) => r[i]?.level)
      .filter((l): l is Level => typeof l === 'number')
      .sort((a, b) => a - b);
    if (levels.length === 0) return null;
    const mid = Math.floor(levels.length / 2);
    const median = levels.length % 2 ? levels[mid]! : (levels[mid - 1]! + levels[mid]!) / 2;
    return Math.floor(median) as Level;
  });
}

const base = (check: CheckId): ControlCell => ({
  check,
  level: null,
  state: 'not-visible',
  value: null,
  unit: 'percent',
  threshold: null,
  readable: null,
  reason: null,
  note: null,
  environment: null,
  signal: null,
});

const notApplicable = (check: CheckId, reason: ControlReason, note: string | null = null) => ({
  ...base(check),
  state: 'not-applicable' as const,
  reason,
  note,
});
const notVisible = (check: CheckId, reason: ControlReason, note: string | null = null) => ({
  ...base(check),
  reason,
  note,
});

function measured(
  check: CheckId,
  value: number,
  unit: ControlCell['unit'],
  override: readonly number[] | undefined,
  extra: Partial<ControlCell> = {},
): ControlCell {
  const { level, threshold } = levelFor(check, value, override);
  return { ...base(check), state: 'measured', level, threshold, value, unit, ...extra };
}

function fromRatio(
  check: CheckId,
  states: readonly RepoState[],
  override: readonly number[] | undefined,
): ControlCell {
  const r = ratioOverReadable(states);
  if (r.reason === 'no-object') return notApplicable(check, 'no-object');
  if (r.value === null)
    return { ...notVisible(check, r.reason ?? 'source-unreadable'), readable: r.readable };
  return measured(check, r.value, 'percent', override, { readable: r.readable });
}

/** Per unique repository: the control's state across its components. */
function controlStates(s: ProjectSnapshot, control: ControlId, staleIsFail: boolean): RepoState[] {
  return [...controlStatesByRepo(s, control, staleIsFail).values()];
}

function controlStatesByRepo(
  s: ProjectSnapshot,
  control: ControlId,
  staleIsFail: boolean,
): Map<string, RepoState> {
  const byRepo = new Map<string, RepoState[]>();
  for (const comp of s.securityControls) {
    const c = comp.controls.find((x) => x.control === control);
    if (!c) continue;
    const st: RepoState =
      c.state === 'enabled'
        ? 'pass'
        : c.state === 'stale'
          ? staleIsFail
            ? 'fail'
            : 'pass'
          : c.state === 'not-configured' || c.state === 'configured-not-run' || c.state === 'failed'
            ? 'fail'
            : c.state === 'not-applicable'
              ? 'n/a'
              : 'unknown';
    byRepo.set(comp.repository, [...(byRepo.get(comp.repository) ?? []), st]);
  }
  const merged = new Map<string, RepoState>();
  for (const [repo, list] of byRepo)
    merged.set(
      repo,
      list.every((x) => x === 'n/a')
        ? 'n/a'
        : list.includes('pass')
          ? 'pass'
          : list.includes('fail')
            ? 'fail'
            : 'unknown',
    );
  return merged;
}

function repoCheckStates(s: ProjectSnapshot, ids: string[]): RepoState[] {
  return s.repositoryControls.repositories.map((r) => {
    const states = ids.map((id) => r.checks.find((c) => c.id === id)?.state ?? 'unknown');
    if (states.every((x) => x === 'not-applicable')) return 'n/a';
    const relevant = states.filter((x) => x !== 'not-applicable');
    if (relevant.includes('fail')) return 'fail';
    if (relevant.every((x) => x === 'pass')) return 'pass';
    return 'unknown';
  });
}

const DAY_MS = 86_400_000;

function evaluateCheck(
  check: CheckId,
  { snapshot: s, project, extras }: ControlMapInput,
  policies: Policies,
): ControlCell {
  const override = policies.controlMap.thresholds[check];
  const now = Date.parse(s.generatedAt);
  switch (check) {
    case 'sbom-coverage': {
      const states = s.supplyChain.repositories.map((r): RepoState =>
        r.sbom.state === 'available' || r.sbom.state === 'partial'
          ? 'pass'
          : r.sbom.state === 'not-configured'
            ? 'fail'
            : 'unknown',
      );
      const cell = fromRatio(check, states, override);
      if (
        cell.state === 'not-visible' &&
        s.supplyChain.repositories.every((r) => r.sbom.state === 'off')
      )
        return {
          ...cell,
          reason: 'source-unreadable',
          note: 'SBOM reading is off in the policies',
        };
      return cell;
    }
    case 'image-signature': {
      const digests = new Map<string, RepoState>();
      for (const r of s.supplyChain.repositories)
        for (const img of r.images) {
          const key =
            img.digest ?? `${r.repository}/${img.name ?? img.componentId}:${img.tag ?? ''}`;
          const st: RepoState =
            img.signature === 'verified'
              ? 'pass'
              : img.signature === 'unknown'
                ? 'unknown'
                : 'fail';
          if (digests.get(key) !== 'pass') digests.set(key, st);
        }
      return fromRatio(check, [...digests.values()], override);
    }
    case 'build-provenance': {
      const states = s.supplyChain.repositories.map((r): RepoState => {
        const a = r.attestations;
        if (a.state === 'not-applicable' || a.state === 'off') return 'n/a';
        if (a.state === 'available') return (a.withProvenance ?? 0) > 0 ? 'pass' : 'fail';
        if (a.state === 'none') return 'fail';
        return 'unknown';
      });
      return fromRatio(check, states, override);
    }
    case 'license-policy': {
      const known = s.supplyChain.repositories
        .map((r) => r.sbom.flagged)
        .filter((v): v is number => v !== null);
      if (known.length === 0) return notVisible(check, 'source-unreadable', 'no readable SBOM');
      const flagged = known.reduce((a, b) => a + b, 0);
      const policy = policies.supplyChain.sbom.flaggedLicenses.length > 0;
      const level: Level = flagged > 0 ? 1 : policy ? 5 : 3;
      return {
        ...base(check),
        state: 'measured',
        level,
        value: flagged,
        unit: 'count',
        note: policy ? null : 'no flagged-license policy set',
      };
    }
    case 'dependency-scanning':
      return fromRatio(check, controlStates(s, 'dependabot', false), override);
    case 'sast':
      return fromRatio(check, controlStates(s, 'codeScanning', true), override);
    case 'container-scanning':
      return fromRatio(check, controlStates(s, 'containerScanning', false), override);
    case 'iac-scanning':
      return fromRatio(check, controlStates(s, 'iacScanning', false), override);
    case 'dast':
      return fromRatio(check, controlStates(s, 'dast', false), override);
    case 'vulnerability-age': {
      const r = s.securityHealth.remediation;
      if (!r.enabled)
        return notVisible(check, 'source-unreadable', 'remediation deadlines are off');
      const crit = r.overdue.critical;
      const high = r.overdue.high;
      if (crit === null || high === null) return notVisible(check, 'source-unreadable');
      const overdue = crit + high;
      const nearDue = s.securityFindings.some(
        (f) =>
          (f.severity === 'critical' || f.severity === 'high') &&
          f.sla?.state === 'within' &&
          f.sla.dueAt !== null &&
          Date.parse(f.sla.dueAt) - now <= 7 * DAY_MS,
      );
      const level: Level =
        overdue === 0 ? (nearDue ? 4 : 5) : overdue <= 2 ? 3 : overdue <= 5 ? 2 : 1;
      return { ...base(check), state: 'measured', level, value: overdue, unit: 'count' };
    }
    case 'security-mttr':
      return extras.resolvedMedianDays === null
        ? notVisible(check, 'source-unreadable', 'no resolved critical or high alert dates')
        : measured(check, extras.resolvedMedianDays, 'days', override);
    case 'secret-scanning': {
      // The scanning ratio sets the level (spec §5.2); levels 4–5 also need push protection on
      // at least 90% of the scanned repositories whose setting could be read. Not read at all:
      // capped at 3, never guessed.
      const scanning = controlStatesByRepo(s, 'secretScanning', false);
      const cell = fromRatio(check, [...scanning.values()], override);
      if (cell.state !== 'measured' || (cell.level as number) <= 3) return cell;
      const scanned = [...scanning].filter(([, st]) => st === 'pass').map(([repo]) => repo);
      const known = scanned
        .map((repo) => extras.pushProtection?.get(repo) ?? null)
        .filter((v) => v !== null);
      if (known.length === 0)
        return { ...cell, level: 3, note: 'push protection not read: capped at level 3' };
      const on = (known.filter((v) => v === 'enabled').length / known.length) * 100;
      return on >= 90
        ? cell
        : {
            ...cell,
            level: 3,
            note: `push protection on ${Math.round(on)}% of scanned repositories`,
          };
    }
    case 'exposed-secrets': {
      const open = s.securityHealth.openSecretAlerts;
      if (open === null) return notVisible(check, 'source-unreadable');
      const window = policies.controlMap.windows.trendDays * DAY_MS;
      const recent = s.securityFindings.some(
        (f) =>
          f.source === 'github-secret-scanning' &&
          f.detectedAt !== null &&
          now - Date.parse(f.detectedAt) <= window,
      );
      const level: Level = open > 0 ? 1 : recent ? 4 : 5;
      return { ...base(check), state: 'measured', level, value: open, unit: 'count' };
    }
    case 'workload-identity': {
      const w = extras.workloadIdentity;
      if (w === null) return notVisible(check, 'source-unreadable', 'workflow files not read');
      if (w.deploying === 0) return notApplicable(check, 'no-object', 'no deploying workflow');
      return measured(check, Math.round((w.oidc / w.deploying) * 1000) / 10, 'percent', override, {
        readable: { k: w.deploying, n: w.deploying },
      });
    }
    case 'branch-protection':
      return fromRatio(
        check,
        repoCheckStates(s, ['branch-protected', 'pull-request-required', 'force-push-blocked']),
        override,
      );
    case 'required-checks':
      return fromRatio(check, repoCheckStates(s, ['status-checks-required']), override);
    case 'pipeline-integrity':
      return fromRatio(
        check,
        repoCheckStates(s, ['actions-pinned', 'reusable-workflows-current']),
        override,
      );
    case 'environment-separation': {
      const envs = project.environments;
      if (envs.length === 0) return notApplicable(check, 'no-object', 'no environments');
      if (envs.length === 1)
        return { ...base(check), state: 'measured', level: 1, value: 1, unit: 'level' };
      const gh = extras.environments;
      if (gh === 'not-authorised') return notVisible(check, 'needs-permission');
      if (gh === null) return notVisible(check, 'source-unreadable');
      const names = new Set(gh.map((e) => e.name.toLowerCase()));
      const mapped = envs.filter((e) => names.has((e.githubEnvironment ?? e.id).toLowerCase()));
      const prod = envs.find((e) => e.delivery) ?? envs.at(-1)!;
      const prodGh = gh.find(
        (e) => e.name.toLowerCase() === (prod.githubEnvironment ?? prod.id).toLowerCase(),
      );
      const level: Level =
        mapped.length < 2 ? 2 : !prodGh?.protected ? 3 : prodGh.branchPolicy ? 5 : 4;
      return {
        ...base(check),
        state: 'measured',
        level,
        value: level,
        unit: 'level',
        environment: prod.name,
      };
    }
    case 'config-drift': {
      if (project.environments.length === 0)
        return notApplicable(check, 'no-object', 'no environments');
      const known = s.environments.filter(
        (e) => e.deployment?.sync && e.deployment.sync !== 'unknown',
      );
      if (!s.environments.some((e) => e.deployment)) return notVisible(check, 'no-argocd');
      if (known.length === 0) return notVisible(check, 'source-unreadable');
      const synced = known.filter((e) => e.deployment!.sync === 'synced').length;
      return measured(check, Math.round((synced / known.length) * 1000) / 10, 'percent', override, {
        readable: { k: known.length, n: s.environments.length },
      });
    }
    case 'deploy-frequency':
    case 'lead-time':
    case 'change-failure-rate':
    case 'time-to-restore':
      return deliveryCell(check, input(s, project, extras), override);
    case 'test-coverage': {
      const q = s.qualityHealth;
      if (q.perComponent.length > 0 && q.perComponent.every((c) => c.state === 'not-applicable'))
        return notApplicable(check, 'no-object');
      if (q.percentage === null) return notVisible(check, 'source-unreadable');
      return measured(check, q.percentage, 'percent', override);
    }
    case 'evidence-freshness': {
      const items: boolean[] = [];
      for (const comp of s.securityControls)
        for (const c of comp.controls)
          if (c.state === 'enabled' || c.state === 'stale') items.push(c.state !== 'stale');
      for (const c of s.qualityHealth.perComponent)
        if (c.state === 'readable' || c.state === 'stale') items.push(c.state !== 'stale');
      for (const r of s.supplyChain.repositories)
        if (r.summary.state === 'readable' || r.summary.state === 'stale')
          items.push(r.summary.state !== 'stale');
      for (const w of s.workflows) if (w.lastCompletedRun) items.push(!w.stale);
      if (items.length === 0) return notVisible(check, 'source-unreadable');
      const fresh = items.filter(Boolean).length;
      return measured(check, Math.round((fresh / items.length) * 1000) / 10, 'percent', override, {
        readable: { k: items.length, n: items.length },
      });
    }
  }
}

const input = (snapshot: ProjectSnapshot, project: ProjectConfig, extras: ControlMapExtras) => ({
  snapshot,
  project,
  extras,
});

function deliveryCell(
  check: 'deploy-frequency' | 'lead-time' | 'change-failure-rate' | 'time-to-restore',
  { project, extras }: ControlMapInput,
  override: readonly number[] | undefined,
): ControlCell {
  if (project.environments.length === 0)
    return notApplicable(check, 'no-object', 'no environments');
  const d = extras.deploy;
  if (d === null) return notVisible(check, 'no-deploy-signal');
  const ctx = {
    environment: d.environment,
    signal: d.signal,
    note: d.notes.length ? d.notes.join('; ').slice(0, 200) : null,
  };
  if (d.reason) return { ...notVisible(check, d.reason), ...ctx };
  const value =
    check === 'deploy-frequency'
      ? d.frequencyPerWeek
      : check === 'lead-time'
        ? d.leadHoursMedian
        : check === 'change-failure-rate'
          ? d.cfrPercent
          : d.ttrHoursMedian;
  if (value === null) return { ...notVisible(check, 'insufficient-events'), ...ctx };
  const unit =
    check === 'deploy-frequency'
      ? 'per-week'
      : check === 'change-failure-rate'
        ? 'percent'
        : 'hours';
  return measured(check, value, unit, override, ctx);
}

export function evaluateControlMap(input: ControlMapInput, policies: Policies): ControlMap {
  const excluded = new Map(input.project.controlMap.notApplicable.map((x) => [x.check, x.reason]));
  const cells = CHECK_IDS.map((check) =>
    excluded.has(check)
      ? notApplicable(check, 'catalog-not-applicable', excluded.get(check)!)
      : evaluateCheck(check, input, policies),
  );
  const areaOf = new Map(CONTROL_CHECKS.map((c) => [c.id, c.area]));
  const areas = Object.fromEntries(
    CONTROL_AREAS.map((a) => [a, scoreOf(cells.filter((c) => areaOf.get(c.check) === a))]),
  ) as ControlMap['areas'];
  return { cells, ...scoreOf(cells), areas };
}
