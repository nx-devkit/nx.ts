import { readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import {
  logger,
  type CreateNodesResultArray,
  type CreateNodesV2,
  type ProjectConfiguration,
  type TargetConfiguration,
} from '@nx/devkit';
import { isVerbose, logDebug } from '@nx-devkit/internal';
import { parseTaskfile, type Taskfile, type TaskfileInclude } from './taskfile.ts';
import { buildTaskTarget, isSafeTaskName, targetNameFor } from './targets.ts';
import type { NxDevkitTaskfileOptions } from './types.ts';

const PLUGIN_SCOPE = 'nx-devkit/taskfile';

/** Config files the plugin reacts to — every Taskfile spelling. */
export const TASKFILE_GLOB = '**/{Taskfile.yml,Taskfile.yaml,taskfile.yml,taskfile.yaml}';

/**
 * Basename priority when a directory holds several Taskfile spellings —
 * the same order the `task` CLI probes them.
 */
const TASKFILE_BASENAMES = ['Taskfile.yml', 'taskfile.yml', 'Taskfile.yaml', 'taskfile.yaml'];

/** Additional names `task` probes when an include points at a directory. */
const INCLUDE_BASENAMES = [
  ...TASKFILE_BASENAMES,
  'Taskfile.dist.yml',
  'taskfile.dist.yml',
  'Taskfile.dist.yaml',
  'taskfile.dist.yaml',
];

/** A task collected under its qualified (`ns:`-prefixed) CLI name. */
interface CollectedTask {
  /** The namespace the declaring file was reached through — deps resolve in it. */
  depPrefix: string;
  task: Taskfile['tasks'][string];
}

/**
 * Infer Nx targets from Taskfiles.
 *
 * Every Taskfile becomes a project at its own directory. Each task turns
 * into a `<targetPrefix>:<name>` target running `task <name>` from that
 * directory — the task CLI keeps owning deps, vars, `dir:` and command
 * execution. `includes:` are followed transitively: an included file's
 * tasks surface on the including project under their `ns:`-qualified
 * name, while the included file still infers its own project targets
 * when the glob matches it.
 */
export const createNodesV2: CreateNodesV2<NxDevkitTaskfileOptions> = [
  TASKFILE_GLOB,
  (configFiles, options, context): CreateNodesResultArray => {
    const workspaceRoot = context.workspaceRoot;
    const targetPrefix = options?.targetPrefix ?? 'task';
    const cache = options?.cache === true;

    // One target set per directory — the spelling `task` would pick wins.
    const byDir = new Map<string, string>();
    for (const rawConfigFile of [...configFiles].sort()) {
      const configFile = rawConfigFile.startsWith('./') ? rawConfigFile.slice(2) : rawConfigFile;
      const dir = dirKey(dirname(configFile).replace(/\\/g, '/'));
      const prev = byDir.get(dir);
      if (prev === undefined || basenamePriority(configFile) < basenamePriority(prev)) {
        byDir.set(dir, configFile);
      }
    }

    const results: CreateNodesResultArray = [];
    const parseCache = new Map<string, Taskfile | null>();

    for (const [dir, configFile] of [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (isSkippedDir(dir)) {
        logDebug(PLUGIN_SCOPE, `Skipping ${logSafe(configFile)} — not inside the workspace`);
        continue;
      }

      const collected = new Map<string, CollectedTask>();
      const inputFiles = new Set<string>();
      collectTasks(
        resolve(workspaceRoot, configFile),
        configFile,
        '',
        collected,
        inputFiles,
        new Set<string>(),
        parseCache,
        workspaceRoot,
      );

      // Only non-internal tasks become targets; deps resolve against this
      // set so a dep on an internal or missing task is never emitted.
      const resolvable = new Set<string>();
      for (const [qualified, entry] of collected) {
        if (!entry.task.internal) resolvable.add(qualified);
      }

      const inputs = [...inputFiles].sort().map((f) => `{workspaceRoot}/${f}`);
      const targets: Record<string, TargetConfiguration> = Object.create(null);
      for (const [qualified, entry] of collected) {
        if (entry.task.internal) continue;
        if (!isSafeTaskName(qualified)) {
          logger.warn(
            `[${PLUGIN_SCOPE}] Skipping task '${logSafe(qualified)}' in ${logSafe(configFile)} — unsafe name for a shell command`,
          );
          continue;
        }
        targets[targetNameFor(qualified, targetPrefix)] = buildTaskTarget(qualified, entry.task, {
          targetPrefix,
          depPrefix: entry.depPrefix,
          cache,
          inputs,
          resolvable,
        });
      }

      if (Object.keys(targets).length === 0) continue;
      const project: Partial<Pick<ProjectConfiguration, 'root'>> & {
        targets: Record<string, TargetConfiguration>;
      } = { root: dir, targets };
      results.push([configFile, { projects: { [dir]: project } }]);
      if (isVerbose()) {
        logDebug(
          PLUGIN_SCOPE,
          `Registered ${String(Object.keys(targets).length)} targets on ${logSafe(dir || '.')}`,
        );
      }
    }

    return results;
  },
];

export default createNodesV2;

/**
 * Collect the tasks of `absPath` under `nsPrefix`, following `includes:`
 * transitively. `visiting` is the DFS stack — an include edge back to a
 * file already on the stack is a cycle and is skipped.
 */
function collectTasks(
  absPath: string,
  relPath: string,
  nsPrefix: string,
  collected: Map<string, CollectedTask>,
  inputFiles: Set<string>,
  visiting: Set<string>,
  parseCache: Map<string, Taskfile | null>,
  workspaceRoot: string,
): void {
  if (visiting.has(absPath)) {
    logger.warn(`[${PLUGIN_SCOPE}] Skipping include of ${logSafe(relPath)} — include cycle`);
    return;
  }
  visiting.add(absPath);
  inputFiles.add(relPath);

  const taskfile = loadTaskfile(absPath, relPath, parseCache);
  if (taskfile !== null) {
    for (const [name, task] of Object.entries(taskfile.tasks)) {
      collected.set(`${nsPrefix}${name}`, { depPrefix: nsPrefix, task });
    }
    for (const [ns, include] of Object.entries(taskfile.includes)) {
      if (include.internal) {
        logDebug(PLUGIN_SCOPE, `Skipping internal include '${logSafe(ns)}' in ${logSafe(relPath)}`);
        continue;
      }
      const resolved = resolveInclude(dirname(absPath), include, workspaceRoot);
      if (resolved === null) {
        if (!include.optional) {
          logger.warn(
            `[${PLUGIN_SCOPE}] Could not resolve include '${logSafe(ns)}' in ${logSafe(relPath)}`,
          );
        }
        continue;
      }
      const subPrefix = include.flatten ? nsPrefix : `${nsPrefix}${ns}:`;
      collectTasks(
        resolved.abs,
        resolved.rel,
        subPrefix,
        collected,
        inputFiles,
        visiting,
        parseCache,
        workspaceRoot,
      );
    }
  }

  visiting.delete(absPath);
}

/**
 * Resolve an include to an existing file inside the workspace.
 * `taskfile:` (or `dir:` alone) may name a file or a directory holding a
 * default Taskfile.
 */
function resolveInclude(
  baseDir: string,
  include: TaskfileInclude,
  workspaceRoot: string,
): { abs: string; rel: string } | null {
  const spec = include.taskfile ?? include.dir;
  if (spec === undefined) return null;
  const abs = resolve(baseDir, spec);

  let file: string | null = null;
  if (isFile(abs)) {
    file = abs;
  } else {
    // A directory (or a not-yet-existing path that may be one) — probe
    // the default Taskfile spellings inside it.
    for (const name of INCLUDE_BASENAMES) {
      const candidate = resolve(abs, name);
      if (isFile(candidate)) {
        file = candidate;
        break;
      }
    }
  }
  if (file === null) return null;

  const rel = relative(workspaceRoot, file).replace(/\\/g, '/');
  // An include outside the workspace would produce `{workspaceRoot}/../…`
  // inputs — treat it as unresolvable instead.
  if (rel === '..' || rel.startsWith('../') || rel.split('/').includes('node_modules')) {
    return null;
  }
  return { abs: file, rel };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function loadTaskfile(
  absPath: string,
  relPath: string,
  parseCache: Map<string, Taskfile | null>,
): Taskfile | null {
  const cached = parseCache.get(absPath);
  if (cached !== undefined) return cached;

  let taskfile: Taskfile | null = null;
  let text: string | null = null;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    // A glob entry that vanished — nothing to warn about.
  }
  if (text !== null) {
    try {
      taskfile = parseTaskfile(text, relPath);
    } catch {
      // A broken Taskfile must not break the project graph — warn + skip.
      logger.warn(`[${PLUGIN_SCOPE}] Could not parse ${logSafe(relPath)} — skipping it`);
    }
  }
  parseCache.set(absPath, taskfile);
  return taskfile;
}

/** Directory key: `''` for the workspace root, the path otherwise. */
function dirKey(dir: string): string {
  return dir === '.' ? '' : dir;
}

function basenamePriority(configFile: string): number {
  const name = configFile.slice(configFile.lastIndexOf('/') + 1);
  const idx = TASKFILE_BASENAMES.indexOf(name);
  // Unknown spellings (should not happen — the glob only matches known
  // names) sort after every known one.
  return idx === -1 ? TASKFILE_BASENAMES.length : idx;
}

/** node_modules and paths escaping the workspace never hold projects. */
function isSkippedDir(dir: string): boolean {
  if (dir === '') return false;
  const segments = dir.split('/');
  return segments[0] === '..' || segments.includes('node_modules');
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

export const __testing: { TASKFILE_GLOB: typeof TASKFILE_GLOB } = { TASKFILE_GLOB };
