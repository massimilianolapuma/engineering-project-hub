import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  countsAsOpen,
  ExceptionEntrySchema,
  ExceptionsFileSchema,
  PoliciesSchema,
  PolicyCaseSchema,
  type ExceptionEntry,
  type ExceptionsFile,
  type HealthResult,
  type HealthStatus,
  type Policies,
  type PolicyCase,
  type ProjectSnapshot,
  type Reason,
  type SecurityFinding,
} from '@model/index';
import {
  ConfigError,
  formatIssues,
  loadCatalog,
  parseYamlWith,
  resolveDateTokens,
} from '../config/load';
import {
  evaluateOverall,
  evaluateSecurity,
  sumCounts,
  type SecurityInputs,
} from '../evaluators/health';
import { evaluateScore } from '../evaluators/score';
import { countOpen, emptyCounts } from '../normalizers/security-model';
import { validatePortfolio, validateProject } from '../../../src/lib/validate';
import { resolveRelativeTime } from '../util/clock';
import { explainReason } from './explain';
import {
  applyExceptions,
  validateExceptions,
  type BaseFinding,
  type MatchableFinding,
  type SourceReadability,
} from './exceptions';
import { applySla } from './sla';

export interface PolicyCheckOptions {
  configDir: string;
  exceptionsFile?: string;
  casesDir?: string;
  snapshotDir?: string;
  now: Date;
  failOnWarnings?: boolean;
  allowDateTokens?: boolean;
}

const DEFAULT_CASE_NOW = '2026-01-15T12:00:00Z';
const NATIVE_SOURCE = {
  'code-scanning': { finding: 'github-code-scanning', control: 'codeScanning' },
  dependabot: { finding: 'github-dependabot', control: 'dependabot' },
  'secret-scanning': { finding: 'github-secret-scanning', control: 'secretScanning' },
} as const;
type AlertSource = keyof typeof NATIVE_SOURCE;

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

const reasonLine = (r: Reason) => {
  const params = Object.entries(r.params)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  return `    ${r.level.padEnd(5)} ${r.code}${params ? ` ${params}` : ''} ← ${explainReason(r)}`;
};

/** Everything the run prints and counts. */
class Report {
  readonly lines: string[] = [];
  passed = 0;
  failed = 0;
  warnings = 0;
  ok(line: string) {
    this.lines.push(`✔ ${line}`);
  }
  warn(line: string) {
    this.warnings++;
    this.lines.push(`⚠ ${line}`);
  }
  fail(line: string) {
    this.failed++;
    this.lines.push(`✖ ${line}`);
  }
  finish(failOnWarnings: boolean): { exitCode: 0 | 1 | 2; lines: string[] } {
    this.lines.push(
      `Summary: ${this.passed} passed, ${this.failed} failed, ${this.warnings} warning(s)`,
    );
    const bad = this.failed > 0 || (failOnWarnings && this.warnings > 0);
    return { exitCode: bad ? 1 : 0, lines: this.lines };
  }
}

function explainPolicies(p: Policies): string[] {
  const days = p.remediation.days;
  const level = p.remediation.overdue;
  return [
    'Policy explanation:',
    `  Security is red on: ${p.security.redOnSeverities.join(', ') || 'none'}; amber on: ${p.security.amberOnSeverities.filter((s) => !p.security.redOnSeverities.includes(s)).join(', ') || 'none'}`,
    p.remediation.enabled
      ? `  Remediation SLA days and overdue level: ${(['critical', 'high', 'medium', 'low', 'secret'] as const).map((c) => `${c} ${days[c] ?? 'none'} (${level[c]})`).join(', ')}`
      : '  Remediation SLAs are off',
    `  Exceptions: at most ${p.exceptions.maxDays} days, flagged ${p.exceptions.expiringSoonDays} days before expiry, an expired one is ${p.exceptions.expiredIsAmber ? 'amber' : 'informative'}`,
  ];
}

interface ExceptionsResult {
  file: ExceptionsFile | null;
  fatal: boolean;
}

async function checkExceptions(
  report: Report,
  file: string,
  policies: Policies,
  repositories: ReadonlySet<string>,
  opts: PolicyCheckOptions,
): Promise<ExceptionsResult> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    report.ok(`${file}: 0 exception(s) (file not present)`);
    return { file: null, fatal: false };
  }
  let raw: unknown;
  try {
    raw = parse(text, { prettyErrors: true });
  } catch (e) {
    report.fail(`${file}: invalid YAML: ${(e as Error).message.split('\n')[0]}`);
    return { file: null, fatal: true };
  }
  if (opts.allowDateTokens) raw = resolveDateTokens(raw, opts.now);
  const parsed = ExceptionsFileSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of formatIssues(parsed.error)) report.fail(`${file}: ${issue}`);
    return { file: null, fatal: true };
  }
  const issues = validateExceptions(parsed.data, policies, repositories, opts.now);
  let errors = 0;
  for (const i of issues) {
    if (i.level === 'error') {
      errors++;
      report.fail(`${file}: ${i.path}: ${i.message}`);
    } else report.warn(`${file}: ${i.path}: ${i.message}`);
  }
  if (!errors) report.ok(`${file}: ${parsed.data.exceptions.length} exception(s)`);
  return { file: parsed.data, fatal: errors > 0 };
}

// ---------------------------------------------------------------------------------------------
// Decision cases
// ---------------------------------------------------------------------------------------------

function securityDecision(c: PolicyCase, policies: Policies, now: Date): HealthResult {
  const input = c.security!;
  const at = (token: string | null) =>
    token === null ? null : token.startsWith('@') ? resolveRelativeTime(token, now) : token;

  const matchable: MatchableFinding[] = input.findings.map((f) => {
    const [repository, source, number] = f.id.split('#') as [string, AlertSource, string];
    const finding: BaseFinding = {
      id: f.id,
      projectId: 'case',
      componentId: 'case',
      repository,
      source: NATIVE_SOURCE[source].finding,
      category:
        source === 'code-scanning' ? 'code' : source === 'dependabot' ? 'dependency' : 'secret',
      severity: f.severity,
      originalSeverity: null,
      status: f.status,
      originalStatus: null,
      ruleId: f.ruleId ?? null,
      title: null,
      detectedAt: at(f.detectedAt),
      updatedAt: null,
      fixAvailable: null,
      htmlUrl: null,
      tool: f.tool ?? null,
      repositoryPrivate: false,
      dataClassification: 'public',
    };
    return {
      finding,
      keys: {
        alert: Number(number),
        ruleId: f.ruleId ?? null,
        tool: f.tool ?? null,
        advisoryIds: f.advisoryIds ?? [],
      },
    };
  });

  const resolved = resolveDateTokens({ exceptions: input.exceptions }, now) as {
    exceptions: unknown[];
  };
  const exceptions: ExceptionEntry[] = resolved.exceptions.map((e) =>
    ExceptionEntrySchema.parse(e),
  );
  // A complete map (every repository x source in play), because a missing pair would read as
  // readable inside the engine.
  const unreadable = new Set(input.unreadable.map((k) => k.toLowerCase()));
  const repositories = new Set([
    ...input.findings.map((f) => f.id.split('#')[0]!),
    ...exceptions.map((e) => e.repository),
  ]);
  const readability: SourceReadability = new Map();
  for (const repository of repositories)
    for (const source of Object.keys(NATIVE_SOURCE)) {
      const key = `${repository}|${source}`;
      readability.set(key, unreadable.has(key.toLowerCase()) ? 'unreadable' : 'readable');
    }
  return decideSecurity({
    findings: matchable,
    exceptions,
    readability,
    policies,
    now,
    countsComplete: input.unreadable.length === 0,
    publicDetail: () => true,
    secretSourceReadable: true,
    anyGitHubSourceReadable: true,
    repos: [],
    coverage: {
      status: 'green',
      reasons: [],
      percentage: 100,
      required: 0,
      available: 0,
      notConfigured: 0,
      notAuthorised: 0,
      unknown: 0,
      failed: 0,
      stale: 0,
      collectedAt: now.toISOString(),
      perControl: [],
    },
    externalCounts: emptyCounts(0),
    detailsWithheld: false,
  });
}

/** The same steps as the collector: exceptions, then SLAs, then evaluation. */
function decideSecurity(a: {
  findings: MatchableFinding[];
  exceptions: ExceptionEntry[];
  readability: SourceReadability;
  policies: Policies;
  now: Date;
  countsComplete: boolean;
  publicDetail: (repository: string) => boolean;
  secretSourceReadable: boolean;
  anyGitHubSourceReadable: boolean;
  repos: SecurityInputs['repos'];
  coverage: SecurityInputs['coverage'];
  externalCounts: SecurityInputs['externalCounts'];
  detailsWithheld: boolean;
}): HealthResult & { findings: SecurityFinding[] } {
  const applied = applyExceptions({
    findings: a.findings,
    exceptions: a.exceptions,
    readability: a.readability,
    publicDetail: a.publicDetail,
    policies: a.policies,
    now: a.now,
  });
  const sla = applySla(applied.findings, a.policies, a.now, a.anyGitHubSourceReadable);
  const findings = sla.findings as SecurityFinding[];
  const githubCounts = a.anyGitHubSourceReadable ? countOpen(findings) : emptyCounts(null);
  const openCounts = sumCounts(githubCounts, a.externalCounts);
  const anySourceReadable = a.anyGitHubSourceReadable || a.externalCounts.critical !== null;
  const openSecretAlerts = a.secretSourceReadable
    ? findings.filter((f) => f.source === 'github-secret-scanning' && countsAsOpen(f)).length
    : null;
  const result = evaluateSecurity(
    {
      findings,
      repos: a.repos,
      coverage: a.coverage,
      externalCounts: a.externalCounts,
      anySourceReadable,
      countsComplete: a.countsComplete,
      secretSourceReadable: a.secretSourceReadable,
      detailsWithheld: a.detailsWithheld,
      remediation: sla.remediation,
      exceptions: applied.records,
      acceptedCount: findings.filter((f) => f.status === 'open' && f.exception?.state === 'active')
        .length,
    },
    openCounts,
    openSecretAlerts,
    a.policies,
  );
  return { ...result, findings };
}

function overallDecision(
  c: PolicyCase,
  policies: Policies,
): { result: HealthResult; score: number | null } {
  const dims = c.overall!.dimensions as Record<
    'delivery' | 'version' | 'security' | 'coverage' | 'governance' | 'quality',
    HealthStatus
  >;
  const result = evaluateOverall(dims, policies);
  const health = Object.fromEntries(
    Object.entries(dims).map(([d, status]) => [d, { status, reasons: [] }]),
  ) as unknown as Parameters<typeof evaluateScore>[0];
  return { result, score: evaluateScore(health, result.status, policies).value };
}

async function runCases(
  report: Report,
  casesDir: string,
  explicitCasesDir: boolean,
  policies: Policies,
): Promise<void> {
  let files: string[];
  try {
    files = (await readdir(casesDir)).filter((f) => /\.ya?ml$/.test(f)).sort();
  } catch {
    files = [];
  }
  if (!files.length) {
    if (explicitCasesDir && !(await exists(casesDir)))
      report.warn(`${casesDir}: no decision cases (directory not found)`);
    else report.warn(`${casesDir}: no decision cases`);
    return;
  }
  for (const f of files) {
    const file = join(casesDir, f);
    let c: PolicyCase;
    try {
      c = parseYamlWith(PolicyCaseSchema, await readFile(file, 'utf8'), file);
    } catch (e) {
      report.fail(`${file}: ${(e as Error).message.replace(/\n\s*/g, ' ')}`);
      continue;
    }
    const now = new Date(c.now ?? DEFAULT_CASE_NOW);
    let result: HealthResult;
    let score: number | null | undefined;
    try {
      if (c.kind === 'security') result = securityDecision(c, policies, now);
      else ({ result, score } = overallDecision(c, policies));
    } catch (e) {
      report.fail(`${c.name} — invalid case: ${(e as Error).message.split('\n')[0]}`);
      continue;
    }
    const label = `${c.name} — ${c.kind === 'security' ? 'Security' : 'Overall'}`;
    const codes = result.reasons.map((r) => r.code as string);
    const problems: string[] = [];
    if (result.status !== c.expect.status)
      problems.push(`expected ${c.expect.status}, got ${result.status}`);
    const missing = (c.expect.reasons ?? []).filter((r) => !codes.includes(r));
    if (missing.length) problems.push(`missing reason(s) ${missing.join(', ')}`);
    const present = (c.expect.absent ?? []).filter((r) => codes.includes(r));
    if (present.length) problems.push(`unexpected reason(s) ${present.join(', ')}`);
    if (c.expect.score !== undefined && c.kind === 'overall' && score !== c.expect.score)
      problems.push(`expected score ${c.expect.score}, got ${score ?? 'null'}`);

    if (problems.length) {
      report.fail(`${c.name} — ${problems.join('; ')}`);
      report.lines.push(`  decision: ${result.status}`);
    } else {
      report.passed++;
      report.ok(`${label} ${result.status}`);
    }
    for (const r of result.reasons) report.lines.push(reasonLine(r));
  }
}

// ---------------------------------------------------------------------------------------------
// Snapshot what-if (read-only)
// ---------------------------------------------------------------------------------------------

const alertNumber = (id: string) => Number(id.slice(id.lastIndexOf('#') + 1));
const STATE_UNREADABLE = new Set(['not-authorised', 'collection-failed', 'unknown']);
const STATE_COUNTED = new Set(['enabled', 'configured-not-run', 'stale', 'not-applicable']);

function reevaluate(
  s: ProjectSnapshot,
  exceptions: ExceptionEntry[],
  policies: Policies,
  now: Date,
  report: Report,
): void {
  const repos = new Set(s.securityControls.map((r) => r.repository.toLowerCase()));
  const mine = exceptions.filter((e) => repos.has(e.repository.toLowerCase()));

  const readability: SourceReadability = new Map();
  for (const rc of s.securityControls) {
    for (const [source, { control }] of Object.entries(NATIVE_SOURCE)) {
      const state = rc.controls.find((c) => c.control === control)?.state;
      readability.set(
        `${rc.repository}|${source}`,
        state && STATE_UNREADABLE.has(state) ? 'unreadable' : 'readable',
      );
    }
  }

  // Match keys come from what the snapshot publishes. A withheld rule id cannot match a rule
  // or advisory selector: those exceptions are reported, and the findings the snapshot says
  // they matched keep that match, so they are never counted as unmatched.
  const notEvaluable = new Set<string>();
  const matchable: MatchableFinding[] = s.securityFindings.map((published) => {
    const { exception: carried, sla: _sla, ...finding } = published;
    const keys = {
      alert: alertNumber(finding.id),
      ruleId: finding.source === 'github-code-scanning' ? finding.ruleId : null,
      tool: finding.source === 'github-code-scanning' ? finding.tool : null,
      advisoryIds: finding.source === 'github-dependabot' && finding.ruleId ? [finding.ruleId] : [],
    };
    if (finding.ruleId === null && carried) {
      const e = mine.find((x) => x.id === carried.id);
      if (e && ('rule' in e.match || 'advisory' in e.match)) {
        notEvaluable.add(e.id);
        if ('rule' in e.match) {
          keys.ruleId = e.match.rule;
          keys.tool = e.match.tool ?? keys.tool;
        } else keys.advisoryIds = [e.match.advisory];
      }
    }
    return { finding, keys };
  });
  for (const e of mine) {
    if (!('rule' in e.match || 'advisory' in e.match) || notEvaluable.has(e.id)) continue;
    const candidates = s.securityFindings.filter(
      (f) =>
        f.repository.toLowerCase() === e.repository.toLowerCase() &&
        f.source === NATIVE_SOURCE[e.source].finding,
    );
    if (candidates.length && candidates.every((f) => f.ruleId === null)) notEvaluable.add(e.id);
  }

  const controlStates = s.securityControls.flatMap((rc) => rc.controls);
  const nativeStates = controlStates.filter((c) =>
    Object.values(NATIVE_SOURCE).some((n) => n.control === c.control),
  );
  const external = controlStates
    .filter(
      (c) =>
        !Object.values(NATIVE_SOURCE).some((n) => n.control === c.control) &&
        c.counts &&
        c.state !== 'not-applicable',
    )
    .reduce((acc, c) => sumCounts(acc, c.counts!), emptyCounts(null));
  const secretStates = nativeStates.filter((c) => c.control === 'secretScanning');

  const security = decideSecurity({
    findings: matchable,
    exceptions: mine,
    readability,
    policies,
    now,
    countsComplete: s.securityHealth.countsComplete,
    publicDetail: () => false,
    secretSourceReadable:
      s.securityHealth.openSecretAlerts !== null ||
      secretStates.some((c) => STATE_COUNTED.has(c.state)),
    anyGitHubSourceReadable: nativeStates.some((c) => STATE_COUNTED.has(c.state)),
    repos: s.securityControls,
    coverage: s.securityCoverage,
    externalCounts: external,
    detailsWithheld: s.securityHealth.reasons.some((r) => r.code === 'private-details-withheld'),
  });
  const overall = evaluateOverall(
    {
      delivery: s.deliveryHealth.status,
      version: s.versionHealth.status,
      security: security.status,
      coverage: s.securityCoverage.status,
      governance: s.governanceHealth.status,
      quality: s.qualityHealth.status,
    },
    policies,
  );

  const changes: string[] = [];
  if (security.status !== s.securityHealth.status)
    changes.push(`security ${s.securityHealth.status} → ${security.status}`);
  if (overall.status !== s.overallHealth.status)
    changes.push(`overall ${s.overallHealth.status} → ${overall.status}`);
  if (changes.length) {
    report.lines.push(`would change: ${s.project.id} ${changes.join('; ')}`);
    for (const r of security.reasons.filter((r) => r.level !== 'info'))
      report.lines.push(reasonLine(r));
  } else report.lines.push(`unchanged: ${s.project.id}`);
  for (const id of [...notEvaluable].sort())
    report.lines.push(`  not evaluable from this snapshot (details withheld): ${id}`);
}

async function runSnapshot(
  report: Report,
  dir: string,
  exceptions: ExceptionEntry[],
  policies: Policies,
  now: Date,
): Promise<void> {
  report.lines.push(`Snapshot ${dir} (read-only):`);
  let indexText: string;
  try {
    indexText = await readFile(join(dir, 'index.json'), 'utf8');
  } catch {
    report.fail(`${join(dir, 'index.json')}: cannot read`);
    return;
  }
  const index = validatePortfolio(indexText);
  if (!index.ok) {
    report.fail(`${join(dir, 'index.json')}: ${index.error.message}`);
    return;
  }
  for (const p of index.data.projects) {
    const file = join(dir, 'projects', `${p.id}.json`);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      report.fail(`${file}: cannot read`);
      continue;
    }
    const project = validateProject(text);
    if (!project.ok) {
      report.fail(`${file}: ${project.error.message}`);
      continue;
    }
    reevaluate(project.data, exceptions, policies, now, report);
  }
}

// ---------------------------------------------------------------------------------------------

export async function runPolicyCheck(
  opts: PolicyCheckOptions,
): Promise<{ exitCode: 0 | 1 | 2; lines: string[] }> {
  const report = new Report();
  const policiesFile = join(opts.configDir, 'policies.yaml');
  let policiesText: string;
  try {
    policiesText = await readFile(policiesFile, 'utf8');
  } catch {
    return {
      exitCode: 2,
      lines: [`✖ ${policiesFile}: cannot read (is --config a config directory?)`],
    };
  }
  const fail = (e: unknown) => {
    report.fail(e instanceof ConfigError ? e.message.replace(/\n\s*/g, ' ') : String(e));
    return report.finish(opts.failOnWarnings ?? false);
  };

  let policies: Policies;
  try {
    policies = parseYamlWith(PoliciesSchema, policiesText, policiesFile);
  } catch (e) {
    return fail(e);
  }
  report.ok(`${policiesFile}: schema ${policies.schemaVersion}`);

  let catalogRepositories: Set<string>;
  try {
    const catalog = await loadCatalog(opts.configDir);
    catalogRepositories = new Set(
      catalog.projects.flatMap((p) =>
        [p.coordinator.repository, ...p.components.map((c) => c.repository)].map((r) =>
          r.toLowerCase(),
        ),
      ),
    );
  } catch (e) {
    return fail(e);
  }

  const exceptionsFile = opts.exceptionsFile ?? join(opts.configDir, 'exceptions.yaml');
  const exceptions = await checkExceptions(
    report,
    exceptionsFile,
    policies,
    catalogRepositories,
    opts,
  );

  report.lines.push(...explainPolicies(policies));

  const casesDir = opts.casesDir ?? join(opts.configDir, 'policy-cases');
  await runCases(report, casesDir, opts.casesDir !== undefined, policies);

  if (opts.snapshotDir) {
    if (exceptions.fatal) report.lines.push('Snapshot skipped: fix the exceptions file first.');
    else
      await runSnapshot(
        report,
        opts.snapshotDir,
        exceptions.file?.exceptions ?? [],
        policies,
        opts.now,
      );
  }
  return report.finish(opts.failOnWarnings ?? false);
}
