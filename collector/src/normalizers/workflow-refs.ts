import { parse } from 'yaml';
import { exactIdentifier } from '../sanitizers/sanitize';
import { WORKFLOW_FILE } from '../providers/types';
import { compareVersions, normaliseVersion, parseVersion } from '../util/semver';

/**
 * Pure parser for the `uses:` references of a workflow file. The workflow text is parsed in memory
 * and discarded: only identifiers rebuilt from validated parts leave this module (never step names,
 * `run:`, `with:`, `env:` or expressions).
 */

export type UsesKind = 'local' | 'action' | 'reusable-workflow' | 'docker' | 'invalid';
export interface UsesRef {
  kind: UsesKind;
  /** Rebuilt from validated parts; null for local / invalid. */
  target: string | null;
  owner: string | null;
  repo: string | null;
  ref: string | null;
  pinned: boolean; // false for local / invalid
}
export interface ParsedWorkflow {
  file: string;
  refs: UsesRef[];
  capped: boolean;
  unparsable: boolean;
}

export const MAX_REFS_PER_FILE = 200;
export const MAX_REFS_PER_REPO = 1000;
const MAX_WORKFLOW_TEXT = 256 * 1024;
const MAX_USES_LENGTH = 400;
/** Published bounds (snapshot schema): `unpinnedRefs[].target` and every `ref`. */
export const MAX_TARGET_LENGTH = 200;
export const MAX_REF_LENGTH = 100;

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const DOCKER_IMAGE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const DOCKER_TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;
/** Segments after the owner (repository included). */
const MAX_SEGMENTS_AFTER_OWNER = 5;

const INVALID: UsesRef = {
  kind: 'invalid',
  target: null,
  owner: null,
  repo: null,
  ref: null,
  pinned: false,
};
const invalid = (): UsesRef => ({ ...INVALID });

function classifyDocker(rest: string): UsesRef {
  const digest = /^(.+)@sha256:([0-9a-f]{64})$/.exec(rest);
  let image: string;
  let ref: string | null;
  let pinned = false;
  if (digest) {
    image = digest[1]!;
    ref = `sha256:${digest[2]}`;
    pinned = true;
  } else {
    const colon = rest.lastIndexOf(':');
    if (colon > rest.lastIndexOf('/')) {
      image = rest.slice(0, colon);
      ref = rest.slice(colon + 1);
      if (!DOCKER_TAG.test(ref)) return invalid();
    } else {
      image = rest;
      ref = null;
    }
  }
  if (!DOCKER_IMAGE.test(image) || image.includes('..') || image.includes('//')) return invalid();
  // Over-long or altered by scrubbing: invalid (unknown), never a truncated identifier.
  const target = exactIdentifier(`docker://${image}`, MAX_TARGET_LENGTH);
  const safeRef = ref === null ? null : exactIdentifier(ref, MAX_REF_LENGTH);
  if (!target || (ref !== null && !safeRef)) return invalid();
  return { kind: 'docker', target, owner: null, repo: null, ref: safeRef, pinned };
}

export function classifyUses(raw: unknown): UsesRef {
  if (typeof raw !== 'string') return invalid();
  const s = raw.trim();
  if (!s || s.length > MAX_USES_LENGTH) return invalid();
  if (s.startsWith('./')) {
    return { kind: 'local', target: null, owner: null, repo: null, ref: null, pinned: false };
  }
  if (s.includes('${{') || /\s/.test(s) || s.includes('..')) return invalid();
  if (s.startsWith('docker://')) return classifyDocker(s.slice('docker://'.length));

  const at = s.indexOf('@');
  if (at < 1) return invalid();
  const ref = s.slice(at + 1);
  if (!REF.test(ref)) return invalid();
  const segments = s.slice(0, at).split('/');
  const [owner, repo, ...path] = segments;
  if (!owner || !repo || !OWNER.test(owner) || !REPO.test(repo) || repo === '.') return invalid();
  if (segments.length - 1 > MAX_SEGMENTS_AFTER_OWNER) return invalid();
  if (!path.every((p) => SEGMENT.test(p) && p !== '.')) return invalid();

  let kind: UsesKind = 'action';
  if (path[0] === '.github' && path[1] === 'workflows') {
    if (path.length !== 3 || !WORKFLOW_FILE.test(path[2]!)) return invalid();
    kind = 'reusable-workflow';
  }
  const target = exactIdentifier([owner, repo, ...path].join('/'), MAX_TARGET_LENGTH);
  const safeRef = exactIdentifier(ref, MAX_REF_LENGTH);
  if (!target || !safeRef) return invalid();
  return {
    kind,
    target,
    owner,
    repo,
    ref: safeRef,
    pinned: FULL_SHA.test(ref),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Walks only `jobs.*.uses` and `jobs.*.steps[*].uses`; everything else is ignored. */
export function parseWorkflow(file: string, text: string): ParsedWorkflow {
  const result: ParsedWorkflow = { file, refs: [], capped: false, unparsable: false };
  if (text.length > MAX_WORKFLOW_TEXT) return { ...result, unparsable: true };
  let doc: unknown;
  try {
    // logLevel 'error': warnings quote the (untrusted, possibly private) source and would reach
    // the collector's log. Errors still throw ('silent' would swallow them).
    doc = parse(text, { maxAliasCount: 100, uniqueKeys: false, logLevel: 'error' });
  } catch {
    return { ...result, unparsable: true };
  }
  const add = (raw: unknown): boolean => {
    if (result.refs.length >= MAX_REFS_PER_FILE) {
      result.capped = true;
      return false;
    }
    result.refs.push(classifyUses(raw));
    return true;
  };
  const jobs = isRecord(doc) ? doc.jobs : null;
  if (!isRecord(jobs)) return result;
  for (const job of Object.values(jobs)) {
    if (!isRecord(job)) continue;
    if ('uses' in job && !add(job.uses)) return result;
    if (Array.isArray(job.steps)) {
      for (const step of job.steps) {
        if (isRecord(step) && 'uses' in step && !add(step.uses)) return result;
      }
    }
  }
  return result;
}

export type ReusableStatus = 'current' | 'behind' | 'untagged' | 'floating' | 'unknown';
export interface TargetVersions {
  latest: string | null; // tag name of latest release or latest tag, raw
  tags: { name: string; sha: string }[] | null; // null = not read / not visible
  visible: boolean;
}

/** Compares a reusable-workflow ref with the latest release or tag of the referenced repository. */
export function reusableStatus(
  ref: string,
  target: TargetVersions,
): { status: ReusableStatus; latest: string | null } {
  const latestRaw = target.latest;
  const unknown = { status: 'unknown' as const, latest: latestRaw };
  const latest = normaliseVersion(latestRaw);
  if (!target.visible || latest === null) return unknown;

  let effective = ref;
  if (FULL_SHA.test(ref)) {
    if (target.tags === null) return unknown;
    const tag = target.tags.find((t) => t.sha === ref);
    if (!tag) return { status: 'untagged', latest: latestRaw };
    effective = tag.name;
  }

  const latestParsed = parseVersion(latest);
  // A pre-release latest normally comes from the tag fallback (GitHub's latest release is never
  // marked pre-release):
  // a stable ref below it may well be on the newest stable version, so it is unknown, not behind.
  const latestIsPre = latestParsed !== null && latestParsed.prerelease !== null;
  const version = normaliseVersion(effective);
  const parsed = version !== null ? parseVersion(version) : null;
  if (version !== null && parsed) {
    const cmp = compareVersions(version, latest);
    if (cmp === null) return unknown;
    if (cmp < 0 && latestIsPre && parsed.prerelease === null) return unknown;
    return { status: cmp < 0 ? 'behind' : 'current', latest: latestRaw };
  }
  const alias = /^v?(\d+)$/i.exec(effective);
  if (alias && latestParsed) {
    const major = Number(alias[1]);
    if (major < latestParsed.major && latestIsPre) return unknown;
    return { status: major < latestParsed.major ? 'behind' : 'current', latest: latestRaw };
  }
  if (alias) return unknown;
  return { status: 'floating', latest: latestRaw };
}
