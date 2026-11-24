import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { minimatch } from 'minimatch';
import { logDebug } from '@nx-devkit/internal';
import { parseCargoToml, type CargoDep, type CargoManifest } from './cargo-toml.ts';

const PLUGIN_SCOPE = 'nx-devkit/cargo';

/**
 * Every directory under `absDir` that contains a `Cargo.toml`, expressed
 * relative to `baseRel` (posix). `node_modules`, `target`, and hidden
 * directories are never descended into — a cargo `target/` tree can hold
 * tens of thousands of dirs.
 */
export function collectCargoDirs(absDir: string, baseRel: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    if (existsSync(join(abs, 'Cargo.toml'))) out.push(rel);
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name === 'node_modules' || name === 'target' || name.startsWith('.')) continue;
      walk(join(abs, name), rel === '' ? name : `${rel}/${name}`);
    }
  };
  walk(resolve(absDir), baseRel);
  return out;
}

/**
 * Expand `[workspace] members` globs against directories that contain a
 * Cargo.toml, then subtract `exclude` globs. Patterns and results are
 * relative to the workspace-root manifest directory `wsDir`; results are
 * sorted for deterministic output.
 *
 * `members` patterns may be literal paths (`crates/foo`) or globs
 * (`crates/*`). The root package itself is always a member when the root
 * manifest carries `[package]` — pass `hasRootPackage` so `"."` is folded
 * in even when `members` omits it.
 */
export function expandMembers(
  workspaceRoot: string,
  wsDir: string,
  patterns: string[],
  exclude: string[],
  hasRootPackage: boolean,
): string[] {
  const wsAbs = resolve(workspaceRoot, wsDir);
  const cargoDirs = collectCargoDirs(wsAbs, '');
  const memberSet = new Set<string>();

  for (const rawPattern of patterns) {
    const pattern = normalizeRel(rawPattern);
    for (const dir of cargoDirs) {
      // `members = ["."]` normalizes to the empty pattern — match the
      // workspace root itself exactly.
      if (pattern === '' ? dir === '' : minimatch(dir, pattern, { dot: true })) {
        memberSet.add(dir);
      }
    }
  }
  // The root package is an implicit workspace member.
  if (hasRootPackage && existsSync(join(wsAbs, 'Cargo.toml'))) memberSet.add('');

  const excludes = exclude.map(normalizeRel);
  const members = [...memberSet].filter(
    (dir) => !excludes.some((pattern) => minimatch(dir, pattern, { dot: true })),
  );
  return members.map((dir) => joinRel(wsDir, dir)).sort();
}

/**
 * Read and parse a Cargo.toml at `absPath`; null when missing or
 * unparseable. Broken manifests never break the graph — they are logged
 * and skipped.
 */
export function readManifest(absPath: string): CargoManifest | null {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  try {
    return parseCargoToml(text);
  } catch {
    logDebug(PLUGIN_SCOPE, `Could not parse ${logSafe(absPath)}`);
    return null;
  }
}

/**
 * The directory whose Cargo.lock the crate's targets hash. A crate with
 * its own `[workspace]` table is a workspace root and locks in place;
 * otherwise the nearest ancestor manifest that declares a `[workspace]`
 * owns the lockfile (excluded crates fall back to their own dir — cargo
 * treats them as standalone). A crate outside every workspace is a
 * single-package workspace: its own dir holds Cargo.lock.
 *
 * `membersOf` lazily expands a workspace root's member dirs (cached —
 * globs walk the filesystem once per root).
 */
export function resolveLockfileRoot(
  crateDir: string,
  manifest: CargoManifest,
  manifestAt: (dir: string) => CargoManifest | null,
  membersOf: (wsDir: string, manifest: CargoManifest) => string[],
): string {
  if (manifest.workspace !== null) return crateDir;

  for (let dir = crateDir; dir !== ''; dir = parentDir(dir)) {
    const parent = parentDir(dir);
    const ancestor = manifestAt(parent);
    if (ancestor?.workspace == null) continue;
    const members = membersOf(parent, ancestor);
    if (members.includes(crateDir)) return parent;
    if (isExcluded(crateDir, parent, ancestor)) return crateDir;
    // Under a workspace root but in neither members nor exclude — cargo
    // would reject this layout; the ancestor lockfile is the best guess.
    return parent;
  }
  return crateDir;
}

/**
 * Project names this crate path-depends on — for
 * `implicitDependencies` edges. `[dependencies]`/`dev-`/`build-` and
 * `target.*` tables are all flattened into `manifest.deps`; a dep with
 * `workspace = true` resolves its `path` through the owning workspace
 * root's `[workspace.dependencies]`. Deps whose target manifest cannot
 * be read fall back to the declared dep key.
 */
export function collectPathDeps(
  manifest: CargoManifest,
  crateDir: string,
  lockfileRoot: string,
  manifestAt: (dir: string) => CargoManifest | null,
): string[] {
  const deps = new Set<string>();
  for (const dep of manifest.deps) {
    const dir = depDir(dep, crateDir, lockfileRoot, manifestAt);
    if (dir === undefined) continue;
    const target = manifestAt(dir);
    const name = target?.packageName ?? dep.name;
    if (name !== manifest.packageName) deps.add(name);
  }
  return [...deps].sort();
}

/**
 * Workspace-relative dirs of a crate's path dependencies — for target
 * inputs, so a dep's manifest and sources bust the cache. Same
 * resolution rules as `collectPathDeps`: `path` deps join onto the
 * crate dir, `workspace = true` deps inherit `path` through the owning
 * root's `[workspace.dependencies]`; dirs escaping the workspace root
 * are skipped.
 */
export function collectDepDirs(
  manifest: CargoManifest,
  crateDir: string,
  lockfileRoot: string,
  manifestAt: (dir: string) => CargoManifest | null,
): string[] {
  const dirs = new Set<string>();
  for (const dep of manifest.deps) {
    const dir = depDir(dep, crateDir, lockfileRoot, manifestAt);
    if (dir !== undefined) dirs.add(dir);
  }
  return [...dirs].sort();
}

/** A dep's workspace-relative dir; undefined for pathless deps and escapes. */
function depDir(
  dep: CargoDep,
  crateDir: string,
  lockfileRoot: string,
  manifestAt: (dir: string) => CargoManifest | null,
): string | undefined {
  let dir: string | undefined;
  if (dep.path !== undefined) {
    dir = joinRel(crateDir, dep.path);
  } else if (dep.workspace === true) {
    const wsDeps = manifestAt(lockfileRoot)?.workspace?.dependencies ?? {};
    const inherited = wsDeps[dep.name];
    if (inherited?.path !== undefined) dir = joinRel(lockfileRoot, inherited.path);
  }
  if (dir === undefined) return undefined;
  if (dir === '..' || dir.startsWith('../')) {
    logDebug(PLUGIN_SCOPE, `Path dep ${logSafe(dep.name)} escapes the workspace — skipped`);
    return undefined;
  }
  return dir;
}

/**
 * `base/rel` normalized to a posix workspace-relative path. `..` segments
 * that climb above the workspace root return a path starting with `../`
 * so callers can detect and reject escapes.
 */
export function joinRel(base: string, rel: string): string {
  const segs = base === '' ? [] : base.split('/');
  for (const part of rel.replaceAll('\\', '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (segs.length === 0 || segs[segs.length - 1] === '..') {
        segs.push('..');
      } else {
        segs.pop();
      }
    } else {
      segs.push(part);
    }
  }
  return segs.join('/');
}

/** Posix parent dir; `''` stays `''` (caller checks termination). */
function parentDir(dir: string): string {
  const parent = dirname(dir).replaceAll(sep, '/');
  return parent === '.' ? '' : parent;
}

function isExcluded(crateDir: string, wsDir: string, manifest: CargoManifest): boolean {
  const rel = crateDir === wsDir ? '' : crateDir.slice(wsDir === '' ? 0 : wsDir.length + 1);
  return (manifest.workspace?.exclude ?? [])
    .map(normalizeRel)
    .some((pattern) => minimatch(rel, pattern, { dot: true }));
}

/** Strip leading `./` and trailing `/` so patterns and dirs compare equally. */
function normalizeRel(value: string): string {
  let out = value.replaceAll('\\', '/');
  if (out.startsWith('./')) out = out.slice(2);
  while (out.endsWith('/')) out = out.slice(0, -1);
  return out === '.' ? '' : out;
}

/**
 * A value from the manifest, safe to put into a log message — the
 * manifest is untrusted input, and a log line must stay one line.
 * C0/C1 controls and bidi override/isolate characters become spaces.
 */
export function logSafe(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out +=
      code < 32 ||
      (code >= 127 && code <= 159) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
        ? ' '
        : char;
  }
  return out.trim();
}
