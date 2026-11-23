import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit';

export interface NxDepsPluginOptions {
  /** Name of the report-only consistency target. Default: "deps:check". */
  checkTargetName?: string;
  /** Also infer a fix target (`deps:fix`, syncpack only). Default: true. */
  fixTarget?: boolean;
  /** Name of the fix target. Default: "deps:fix". */
  fixTargetName?: string;
}

// Standalone syncpack configs (cosmiconfig search places) plus package.json,
// Which can host a "syncpack" key or — at the workspace root only — a
// workspaces + manypkg fallback.
const DEPS_GLOB =
  '**/{syncpack.config.{js,cjs,mjs,ts},.syncpackrc,.syncpackrc.{json,yaml,yml,js,cjs,mjs,ts},package.json}';

const SYNPACK_CONFIG_NAMES = new Set([
  '.syncpackrc',
  '.syncpackrc.json',
  '.syncpackrc.yaml',
  '.syncpackrc.yml',
  '.syncpackrc.js',
  '.syncpackrc.cjs',
  '.syncpackrc.mjs',
  '.syncpackrc.ts',
  'syncpack.config.js',
  'syncpack.config.cjs',
  'syncpack.config.mjs',
  'syncpack.config.ts',
]);

// Lockfiles live at the workspace root no matter which directory owns the
// Config; deps:check verdicts depend only on manifests + lockfile.
const LOCKFILE_INPUTS = [
  '{workspaceRoot}/bun.lock',
  '{workspaceRoot}/bun.lockb',
  '{workspaceRoot}/package-lock.json',
  '{workspaceRoot}/yarn.lock',
  '{workspaceRoot}/pnpm-lock.yaml',
  '{workspaceRoot}/pnpm-workspace.yaml',
];

type Tool = 'syncpack' | 'manypkg';

function isSyncpackConfig(fileName: string): boolean {
  return SYNPACK_CONFIG_NAMES.has(fileName);
}

function readPkg(absPath: string): Record<string, unknown> | null {
  try {
    const pkg = JSON.parse(readFileSync(absPath, 'utf8'));
    return typeof pkg === 'object' && pkg !== null && !Array.isArray(pkg)
      ? (pkg as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hasSyncpackKey(pkg: Record<string, unknown>): boolean {
  return 'syncpack' in pkg;
}

function hasWorkspaces(pkg: Record<string, unknown>): boolean {
  const ws = pkg.workspaces;
  return (Array.isArray(ws) && ws.length > 0) || (typeof ws === 'object' && ws !== null);
}

function hasManypkgDep(pkg: Record<string, unknown>): boolean {
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = pkg[field];
    if (
      typeof deps === 'object' &&
      deps !== null &&
      ('@manypkg/cli' in deps || 'manypkg' in deps)
    ) {
      return true;
    }
  }
  return false;
}

function shouldSkipDir(projectRoot: string, workspaceRoot: string): boolean {
  const rel = relative(workspaceRoot, resolve(workspaceRoot, projectRoot || '.'));
  if (rel === '') return false;
  const segments = rel.split(/[\\/]/);
  return segments.includes('..') || segments.includes('node_modules');
}

type DirEntry = { syncpack: string[]; packageJson: string[] };

// One inference per owning directory — syncpack files and package.json hosts
// are grouped by directory key ('' for the workspace root).
function groupByDir(configFiles: readonly string[]): Map<string, DirEntry> {
  const byDir = new Map<string, DirEntry>();
  for (const configFile of [...configFiles].sort()) {
    const dir = dirname(configFile).replace(/\\/g, '/');
    const key = dir === '.' ? '' : dir;
    const entry = byDir.get(key) ?? { syncpack: [], packageJson: [] };
    const base = configFile.split('/').pop() ?? '';
    if (base === 'package.json') {
      entry.packageJson.push(configFile);
    } else {
      entry.syncpack.push(configFile);
    }
    byDir.set(key, entry);
  }
  return byDir;
}

// Decide the backend for a directory — syncpack wins over the manypkg fallback.
function pickTool(dir: string, entry: DirEntry, pkgs: Array<Record<string, unknown>>): Tool | null {
  if (entry.syncpack.length > 0 || pkgs.some(hasSyncpackKey)) {
    return 'syncpack';
  }
  if (dir === '' && pkgs.some((p) => hasWorkspaces(p) && hasManypkgDep(p))) {
    return 'manypkg';
  }
  return null;
}

function buildTargets(
  tool: Tool,
  dir: string,
  files: string[],
  checkTargetName: string,
  fixTargetName: string,
  fixTarget: boolean,
): Record<string, TargetConfiguration> {
  const prefix = dir ? '{projectRoot}' : '{workspaceRoot}';
  // Every deps-bearing file in the dir must bust the cache — paths are
  // Relative to the project root ("" for the root project).
  const configInputs = files.map((f) => `${prefix}/${dir ? f.slice(dir.length + 1) : f}`);
  const inputs = [`${prefix}/**/package.json`, ...LOCKFILE_INPUTS, ...configInputs];
  const command = tool === 'syncpack' ? 'npx syncpack lint' : 'npx manypkg check';
  const targets: Record<string, TargetConfiguration> = {
    [checkTargetName]: {
      executor: 'nx:run-commands',
      cache: true,
      inputs,
      options: { command, cwd: '{projectRoot}' },
    },
  };
  if (tool === 'syncpack' && fixTarget) {
    targets[fixTargetName] = {
      executor: 'nx:run-commands',
      cache: false,
      options: { command: 'npx syncpack fix', cwd: '{projectRoot}' },
    };
  }
  return targets;
}

export const createNodesV2: CreateNodesV2<NxDepsPluginOptions> = [
  DEPS_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot;
    const checkTargetName = options.checkTargetName ?? 'deps:check';
    const fixTargetName = options.fixTargetName ?? 'deps:fix';
    const fixTarget = options.fixTarget ?? true;

    const results: Array<readonly [string, { projects: Record<string, ProjectConfiguration> }]> =
      [];
    const entries = [...groupByDir(configFiles).entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [dir, entry] of entries) {
      if (shouldSkipDir(dir, workspaceRoot)) continue;

      const pkgs = entry.packageJson
        .map((f) => readPkg(resolve(workspaceRoot, f)))
        .filter((p): p is Record<string, unknown> => p !== null);

      const tool = pickTool(dir, entry, pkgs);
      const winner = [...entry.syncpack, ...entry.packageJson].at(0);
      if (tool === null || winner === undefined) continue;

      const files = [...entry.syncpack, ...entry.packageJson];
      const targets = buildTargets(tool, dir, files, checkTargetName, fixTargetName, fixTarget);
      results.push([winner, { projects: { [dir]: { root: dir, targets } } }]);
    }
    return results;
  },
];

export default createNodesV2;

export const __testing: {
  DEPS_GLOB: typeof DEPS_GLOB;
  hasManypkgDep: typeof hasManypkgDep;
  hasSyncpackKey: typeof hasSyncpackKey;
  hasWorkspaces: typeof hasWorkspaces;
  isSyncpackConfig: typeof isSyncpackConfig;
} = {
  DEPS_GLOB: DEPS_GLOB,
  hasManypkgDep: hasManypkgDep,
  hasSyncpackKey: hasSyncpackKey,
  hasWorkspaces: hasWorkspaces,
  isSyncpackConfig: isSyncpackConfig,
};
