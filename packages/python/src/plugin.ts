import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  logger,
  type CreateNodesResultArray,
  type CreateNodesV2,
  type ProjectConfiguration,
  type TargetConfiguration,
} from '@nx/devkit';
import { logDebug, shouldSkipPath } from '@nx-devkit/internal';
import { detectRunner, detectTools, parsePyProject } from './pyproject.ts';
import { buildTargets } from './targets.ts';
import type { NxDevkitPythonOptions } from './types.ts';

const PLUGIN_SCOPE = 'nx-devkit/python';

/** Config file the plugin reacts to — one per Python project. */
export const PYPROJECT_GLOB = '**/pyproject.toml';

type ProjectMap = Record<
  string,
  Partial<Pick<ProjectConfiguration, 'root'>> & {
    targets?: Record<string, TargetConfiguration>;
  }
>;

/**
 * Infer Nx targets from pyproject.toml.
 *
 * Every directory containing a pyproject.toml is a project. Only tools
 * the file actually declares get targets: pytest → `test`, ruff → `lint`
 * + `fmt`, ty/pyright → `typecheck`, uv/poetry → `lock`. The runner comes
 * from the project manager: `[tool.uv]` or a `uv.lock` prefixes commands
 * with `uv run`, `[tool.poetry]` with `poetry run`, otherwise tools run
 * plain.
 */
export const createNodesV2: CreateNodesV2<NxDevkitPythonOptions> = [
  PYPROJECT_GLOB,
  (configFiles, options = {}, context): CreateNodesResultArray => {
    const workspaceRoot = context.workspaceRoot;

    // First pass: normalize, skip, and parse every candidate so the set of
    // project roots is known before any target is built — pytest's
    // recursive collection needs the nested-project list.
    const parsed: { configFile: string; projectRoot: string; doc: Record<string, unknown> }[] = [];
    for (const rawConfigFile of [...configFiles].sort()) {
      // Nx's glob expander can emit a leading "./" — normalize so the path
      // stays canonical in result keys.
      const configFile = rawConfigFile.startsWith('./') ? rawConfigFile.slice(2) : rawConfigFile;
      const dir = dirname(configFile).replace(/\\/g, '/');
      const projectRoot = dir === '.' ? '' : dir;
      if (isSkippedDir(projectRoot, workspaceRoot)) {
        logDebug(PLUGIN_SCOPE, `Skipping ${logSafe(configFile)} — not inside the workspace`);
        continue;
      }

      const doc = readPyProject(resolve(workspaceRoot, configFile), configFile);
      if (doc === null) continue;
      parsed.push({ configFile, projectRoot, doc });
    }

    const projectRoots = parsed.map((p) => p.projectRoot);
    const results: CreateNodesResultArray = [];

    for (const { configFile, projectRoot, doc } of parsed) {
      const tools = detectTools(doc);
      // uv.lock marks the project as uv-managed even without [tool.uv];
      // in a uv workspace the lock file lives at the workspace root.
      const hasProjectLock = existsSync(join(workspaceRoot, projectRoot, 'uv.lock'));
      const hasWorkspaceLock = projectRoot !== '' && existsSync(join(workspaceRoot, 'uv.lock'));
      const runner = detectRunner(tools, hasProjectLock || hasWorkspaceLock);

      const lockInputs = buildLockInputs(runner, hasWorkspaceLock);
      const nestedProjectDirs = projectRoots
        .filter(
          (root) =>
            root !== projectRoot && (projectRoot === '' || root.startsWith(`${projectRoot}/`)),
        )
        .map((root) => (projectRoot === '' ? root : root.slice(projectRoot.length + 1)))
        .sort();
      const targets = buildTargets({ tools, runner, lockInputs, nestedProjectDirs, options });

      const projects: ProjectMap = { [projectRoot]: { root: projectRoot, targets } };
      logDebug(
        PLUGIN_SCOPE,
        `Registered ${logSafe(projectRoot || '.')} from ${logSafe(configFile)}`,
      );
      results.push([configFile, { projects }]);
    }

    return results;
  },
];

export default createNodesV2;

/**
 * Lock-file inputs for the resolved runner. `uv.lock` is also hashed at
 * the workspace root when that is what marked the project uv-managed.
 */
function buildLockInputs(runner: 'uv' | 'poetry' | 'plain', hasWorkspaceLock: boolean): string[] {
  if (runner === 'uv') {
    return hasWorkspaceLock
      ? ['{projectRoot}/uv.lock', '{workspaceRoot}/uv.lock']
      : ['{projectRoot}/uv.lock'];
  }
  if (runner === 'poetry') return ['{projectRoot}/poetry.lock'];
  return [];
}

function readPyProject(absPath: string, configFile: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  try {
    return parsePyProject(text);
  } catch {
    // A broken pyproject.toml must not break the project graph — warn and skip.
    logger.warn(`[${PLUGIN_SCOPE}] Could not parse ${logSafe(configFile)} — skipping it`);
    return null;
  }
}

/**
 * node_modules and paths escaping the workspace are never projects —
 * except the workspace root itself (single-package repos have a root
 * pyproject.toml), which `shouldSkipPath` rejects by design.
 */
function isSkippedDir(projectRoot: string, workspaceRoot: string): boolean {
  if (projectRoot === '') return false;
  return shouldSkipPath(projectRoot, workspaceRoot);
}

/**
 * A value from the config file, safe to put into a log message — the
 * config is untrusted input, and a log line must stay one line.
 */
function logSafe(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out +=
      code < 32 ||
      (code >= 127 && code <= 159) ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
        ? ' '
        : char;
  }
  return out.trim();
}

export const __testing: { PYPROJECT_GLOB: typeof PYPROJECT_GLOB } = { PYPROJECT_GLOB };
