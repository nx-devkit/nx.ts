import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  logger,
  type CreateNodesResultArray,
  type CreateNodesV2,
  type ProjectConfiguration,
  type TargetConfiguration,
} from '@nx/devkit';
import { logDebug } from '@nx-devkit/internal';
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
    const results: CreateNodesResultArray = [];

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

      const tools = detectTools(doc);
      // uv.lock marks the project as uv-managed even without [tool.uv];
      // in a uv workspace the lock file lives at the workspace root.
      const hasProjectLock = existsSync(join(workspaceRoot, projectRoot, 'uv.lock'));
      const hasWorkspaceLock = projectRoot !== '' && existsSync(join(workspaceRoot, 'uv.lock'));
      const runner = detectRunner(tools, hasProjectLock || hasWorkspaceLock);

      const lockInputs = buildLockInputs(runner, hasWorkspaceLock);
      const targets = buildTargets({ tools, runner, lockInputs, options });

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

/** node_modules and paths escaping the workspace are never projects. */
function isSkippedDir(projectRoot: string, workspaceRoot: string): boolean {
  if (projectRoot === '') return false;
  const rel = relative(workspaceRoot, resolve(workspaceRoot, projectRoot));
  if (rel === '') return false;
  const segments = rel.split(/[\\/]/);
  return segments.includes('..') || segments.includes('node_modules');
}

/**
 * A value from the config file, safe to put into a log message — the
 * config is untrusted input, and a log line must stay one line.
 */
function logSafe(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 32 || code === 127 ? ' ' : char;
  }
  return out.trim();
}

export const __testing: { PYPROJECT_GLOB: typeof PYPROJECT_GLOB } = { PYPROJECT_GLOB };
