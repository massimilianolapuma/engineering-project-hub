import {
  CONTROL_IDS,
  FindingCategorySchema,
  FindingSourceSchema,
  NATIVE_CONTROLS,
  requiredControls,
  SNAPSHOT_SCHEMA_VERSION,
  type FindingCategory,
  type FindingSource,
  type Policies,
  type ProjectSnapshot,
  type ProjectSummary,
  type SecurityFinding,
  type SeverityCounts,
} from '@model/index';
import type { RawProjectData } from './collectors/collect';
import {
  evaluateCoverage,
  evaluateDelivery,
  evaluateGovernance,
  evaluateOverall,
  evaluateSecurity,
  evaluateVersion,
  sumCounts,
  type GovernanceRepo,
} from './evaluators/health';
import {
  recordError,
  toReleaseInfo,
  toRepositoryInfo,
  toWorkflowStatus,
  type BuildContext,
} from './normalizers/model';
import {
  countOpen,
  emptyCounts,
  parseStatusFile,
  recordSecurityErrors,
  toFindings,
  toRepositoryControls,
  type ParsedStatusFile,
} from './normalizers/security-model';
import {
  coordinatorVersion,
  parseManifest,
  resolveSubmodules,
  toComponents,
  toEnvironments,
  unknownManifestComponents,
} from './normalizers/versions';

const ALERT_SOURCES = ['codeScanning', 'dependabot', 'secretScanning'] as const;

/** Turns raw provider data for one project into a validated-shape ProjectSnapshot. */
export function buildProjectSnapshot(
  raw: RawProjectData,
  policies: Policies,
  now: Date,
): ProjectSnapshot {
  const { config } = raw;
  const generatedAt = now.toISOString();
  const ctx: BuildContext = { projectId: config.id, policies, now, errors: [] };

  // Monorepos list the same repository for the coordinator and each component: repository-
  // level data (errors, alerts, controls, governance) is evaluated once per repository.
  const uniqueRepos = raw.repos.filter(
    (r, i, all) =>
      all.findIndex((x) => x.repository.toLowerCase() === r.repository.toLowerCase()) === i,
  );
  const componentOf = (repository: string, fallback: string) => {
    const owners = config.components
      .filter((c) => c.path && c.repository.toLowerCase() === repository.toLowerCase())
      .sort((a, b) => b.path!.length - a.path!.length);
    return (path: string | null | undefined) =>
      (path && owners.find((c) => path === c.path || path.startsWith(`${c.path}/`))?.id) ||
      fallback;
  };

  // Repository-level errors first (one per unavailable repository).
  for (const r of uniqueRepos) {
    recordError(ctx, r.repository, r.componentId, 'repository', r.repo);
    if (r.repo.ok) {
      recordError(ctx, r.repository, r.componentId, 'branch', r.head);
      recordError(ctx, r.repository, r.componentId, 'release', r.release, {
        expectedNotFound: true,
      });
      recordError(ctx, r.repository, r.componentId, 'tag', r.tag, { expectedNotFound: true });
    }
  }

  // Versions & submodules.
  const coordinatorData = raw.repos[0]!;
  const { state: manifestState, manifest } = parseManifest(ctx, raw);
  const submodules = resolveSubmodules(ctx, raw);
  const coordinatorRelease = coordinatorData.repo.ok
    ? toReleaseInfo(
        ctx,
        config.coordinator.repository,
        coordinatorData.release,
        coordinatorData.tag,
      )
    : null;
  const coord = coordinatorVersion(manifest, coordinatorRelease);
  const components = toComponents(ctx, raw, manifest, submodules);
  const environments = toEnvironments(config, manifest, coord.version);

  // Workflows.
  const workflows = raw.workflows.map((w) => {
    if (raw.repos.find((r) => r.componentId === w.componentId)?.repo.ok) {
      recordError(ctx, w.repository, w.componentId, 'workflow-runs', w.runs, {
        expectedNotFound: true,
      });
    }
    return toWorkflowStatus(ctx, w);
  });

  // Security.
  const findings: SecurityFinding[] = [];
  let detailsWithheld = false;
  const statusFiles = new Map<string, ParsedStatusFile>();
  const securityControls = uniqueRepos.map((r) => {
    recordSecurityErrors(ctx, r);
    const f = toFindings(ctx, r, componentOf(r.repository, r.componentId));
    detailsWithheld ||= f.withheld;
    findings.push(...f.findings);
    const statusFile = parseStatusFile(ctx, r);
    statusFiles.set(r.componentId, statusFile);
    return toRepositoryControls(ctx, config, r, f.findings, statusFile);
  });

  const required = requiredControls(config);
  const coverage = evaluateCoverage(
    required,
    [...CONTROL_IDS],
    securityControls,
    policies,
    generatedAt,
  );

  const readable = (k: (typeof ALERT_SOURCES)[number]) => raw.repos.filter((r) => r[k].ok).length;
  const anyGitHubSourceReadable = ALERT_SOURCES.some((k) => readable(k) > 0);
  const countsComplete = raw.repos.every((r) =>
    ALERT_SOURCES.every(
      (k) => r[k].ok || (!r[k].ok && r[k].error.classification === 'not-configured'),
    ),
  );
  const external = securityControls
    .flatMap((rc) => rc.controls)
    .filter((c) => !NATIVE_CONTROLS.includes(c.control) && c.counts && c.state !== 'not-applicable')
    .reduce<SeverityCounts>((acc, c) => sumCounts(acc, c.counts!), emptyCounts(null));
  const githubCounts = anyGitHubSourceReadable ? countOpen(findings) : emptyCounts(null);
  const openCounts = sumCounts(githubCounts, external);
  const anySourceReadable = anyGitHubSourceReadable || external.critical !== null;
  const secretSourceReadable = readable('secretScanning') > 0;
  const openSecretAlerts = secretSourceReadable
    ? findings.filter((f) => f.source === 'github-secret-scanning' && f.status === 'open').length
    : null;

  const securityResult = evaluateSecurity(
    {
      findings,
      repos: securityControls,
      coverage,
      externalCounts: external,
      anySourceReadable,
      countsComplete,
      secretSourceReadable,
      detailsWithheld,
    },
    openCounts,
    openSecretAlerts,
    policies,
  );
  const open = findings.filter((f) => f.status === 'open');
  const byCategory = Object.fromEntries(FindingCategorySchema.options.map((c) => [c, 0])) as Record<
    FindingCategory,
    number
  >;
  const bySource = Object.fromEntries(FindingSourceSchema.options.map((s) => [s, 0])) as Record<
    FindingSource,
    number
  >;
  for (const f of open) {
    byCategory[f.category]++;
    bySource[f.source]++;
  }
  // External scanners report counts per control, not individual findings.
  for (const c of securityControls.flatMap((rc) => rc.controls)) {
    if (!c.counts || NATIVE_CONTROLS.includes(c.control) || c.state === 'not-applicable') continue;
    const total =
      (c.counts.critical ?? 0) +
      (c.counts.high ?? 0) +
      (c.counts.medium ?? 0) +
      (c.counts.low ?? 0);
    const category: FindingCategory | null =
      c.control === 'containerScanning'
        ? 'container'
        : c.control === 'iacScanning'
          ? 'iac'
          : c.control === 'dast'
            ? 'dast'
            : null;
    if (category) byCategory[category] += total;
    bySource['security-status-file'] += total;
  }

  // Governance & delivery & version.
  const needsStatusFile = (componentId: string) =>
    securityControls
      .find((rc) => rc.componentId === componentId)!
      .controls.some(
        (c) => c.required && !NATIVE_CONTROLS.includes(c.control) && c.state !== 'not-applicable',
      );
  const coordinatorInfo = toRepositoryInfo(ctx, coordinatorData);
  const governanceRepos: GovernanceRepo[] = uniqueRepos.map((r) => ({
    componentId: r.componentId,
    repository:
      r.componentId === 'coordinator'
        ? coordinatorInfo
        : components.find((c) => c.id === r.componentId)!.repository,
    statusFile: statusFiles.get(r.componentId)!.status,
    needsStatusFile: needsStatusFile(r.componentId),
  }));

  const deliveryHealth = evaluateDelivery(workflows, policies, now);
  const versionHealth = evaluateVersion(
    {
      coordinatorVersion: coord.version,
      manifestState,
      unknownManifestComponents: unknownManifestComponents(config, manifest),
      components,
      submodules,
      environments,
    },
    policies,
  );
  const governanceHealth = evaluateGovernance(governanceRepos, workflows, policies);
  const overallHealth = evaluateOverall(
    {
      delivery: deliveryHealth.status,
      version: versionHealth.status,
      security: securityResult.status,
      coverage: coverage.status,
      governance: governanceHealth.status,
    },
    policies,
  );

  // Freshness.
  const staleSources: ProjectSnapshot['dataFreshness']['staleSources'] = [];
  for (const w of workflows.filter((x) => x.stale)) {
    staleSources.push({
      repository: w.repository,
      source: 'workflow-runs',
      lastUpdatedAt: w.lastCompletedRun?.updatedAt ?? null,
    });
  }
  for (const rc of securityControls) {
    for (const c of rc.controls.filter((x) => x.state === 'stale')) {
      const source = c.control === 'codeScanning' ? 'code-scanning' : 'security-status-file';
      if (!staleSources.some((s) => s.repository === rc.repository && s.source === source)) {
        staleSources.push({ repository: rc.repository, source, lastUpdatedAt: c.lastScanAt });
      }
    }
  }
  const timestamps = staleSources
    .map((s) => s.lastUpdatedAt)
    .filter((t): t is string => !!t)
    .sort();
  const anyRepo = raw.repos.some((r) => r.repo.ok);

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    project: {
      id: config.id,
      name: config.name,
      description: config.description,
      businessUnit: config.businessUnit,
      lifecycle: config.lifecycle,
    },
    coordinator: {
      repository: coordinatorInfo,
      version: coord.version,
      versionSource: coord.source,
      latestRelease: coordinatorRelease,
      manifest: { path: config.coordinator.manifestPath, status: manifestState },
      submodules,
    },
    components,
    environments,
    workflows,
    securityFindings: findings,
    securityControls,
    deliveryHealth,
    versionHealth,
    securityHealth: {
      ...securityResult,
      openCounts,
      countsComplete,
      openSecretAlerts,
      byCategory,
      bySource,
    },
    securityCoverage: coverage,
    governanceHealth,
    overallHealth,
    dataFreshness: {
      status: !anyRepo ? 'grey' : staleSources.length ? 'amber' : 'green',
      collectedAt: generatedAt,
      oldestSourceAt: timestamps[0] ?? null,
      staleSources,
    },
    collectionErrors: ctx.errors,
  };
}

export function toProjectSummary(s: ProjectSnapshot): ProjectSummary {
  const critical = s.workflows.filter((w) => w.critical);
  const knownCritical = critical.filter(
    (w) => w.state !== 'unknown' && w.state !== 'not-authorised',
  );
  return {
    id: s.project.id,
    name: s.project.name,
    businessUnit: s.project.businessUnit,
    lifecycle: s.project.lifecycle,
    overall: s.overallHealth.status,
    delivery: s.deliveryHealth.status,
    version: s.versionHealth.status,
    security: s.securityHealth.status,
    coverage: {
      status: s.securityCoverage.status,
      percentage: s.securityCoverage.percentage,
      required: s.securityCoverage.required,
      available: s.securityCoverage.available,
    },
    governance: s.governanceHealth.status,
    freshness: s.dataFreshness.status,
    openCounts: s.securityHealth.openCounts,
    countsComplete: s.securityHealth.countsComplete,
    openSecretAlerts: s.securityHealth.openSecretAlerts,
    secretScanning:
      s.securityCoverage.perControl.find((c) => c.control === 'secretScanning')?.state ?? 'unknown',
    failedCriticalWorkflows: knownCritical.length
      ? critical.filter((w) => w.state === 'failure' || w.state === 'cancelled').length
      : null,
    collectedAt: s.generatedAt,
    collectionErrorCount: s.collectionErrors.length,
    unresolvedSubmodules: s.coordinator.submodules.filter(
      (x) => x.association === 'unmapped' || x.status !== 'resolved',
    ).length,
  };
}
