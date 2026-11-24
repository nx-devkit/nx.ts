import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  logger,
  type CreateNodesResultArray,
  type CreateNodesV2,
  type ProjectConfiguration,
  type TargetConfiguration,
} from '@nx/devkit';
import { isVerbose, logDebug } from '@nx-devkit/internal';
import { parseTurboJson, type TurboJson, type TurboTask } from './turbo-config.ts';
import {
  discoverWorkspacePackages,
  readPackageJson,
  sortPathsByDepth,
  type WorkspacePackage,
} from './workspace.ts';
import { buildTaskTarget, mapGlobs, splitTaskKey, type TaskInput } from './targets.ts';
import type { NxDevkitTurboOptions } from './types.ts';

const PLUGIN_SCOPE = 'nx-devkit/turbo';

/** Config files the plugin reacts to — root and package-level turbo.json. */
export const TURBO_GLOB = '**/turbo.json';

/** A package's identity for target placement. */
interface PackageRef {
  root: string; // project root, '' for the workspace root
  name: string | undefined;
  scripts: Record<string, string>;
}

/**
 * Infer Nx targets from turbo.json.
 *
 * A root turbo.json fans out: every `tasks`/`pipeline` entry becomes a
 * target on each workspace package whose package.json declares the same
 * script (`pkg#task` → only that package, `//#task` → the root project).
 * A nested turbo.json applies its tasks to its own package only and,
 * being emitted after the root config, overrides the root-inferred task
 * of the same name.
 */
export const createNodesV2: CreateNodesV2<NxDevkitTurboOptions> = [
  TURBO_GLOB,
  (configFiles, _options = {}, context): CreateNodesResultArray => {
    const workspaceRoot = context.workspaceRoot;
    const results: CreateNodesResultArray = [];

    // Resolved lazily — only a root config needs the package list.
    let packages: WorkspacePackage[] | undefined;
    const getPackages = () => (packages ??= discoverWorkspacePackages(workspaceRoot));

    const rootPkg = readRootPackage(workspaceRoot);
    const rootProjectName = readRootProjectName(workspaceRoot, rootPkg.name);

    // package.json name → Nx project name, resolved lazily — only
    // `pkg#task` dependsOn entries need it.
    let projectNames: Map<string, string> | undefined;
    const projectNameFor = (packageName: string): string => {
      projectNames ??= buildProjectNameMap(workspaceRoot, getPackages());
      return projectNames.get(packageName) ?? packageName;
    };

    // The root config, cached for `extends: ["//"]` merges — reused when
    // this batch already parsed it, read lazily from disk otherwise.
    let rootConfig: TurboJson | null | undefined;
    const getRootConfig = (): TurboJson | null => {
      if (rootConfig === undefined) {
        rootConfig = readTurboConfig(resolve(workspaceRoot, 'turbo.json'), 'turbo.json');
      }
      return rootConfig;
    };

    for (const rawConfigFile of sortPathsByDepth(configFiles)) {
      // Nx's glob expander can emit a leading "./" — normalize so the path
      // stays canonical in inputs and result keys.
      const configFile = rawConfigFile.startsWith('./') ? rawConfigFile.slice(2) : rawConfigFile;
      const dir = dirname(configFile).replace(/\\/g, '/');
      const isRoot = dir === '.';
      if (!isRoot && isSkippedDir(dir)) {
        logDebug(PLUGIN_SCOPE, `Skipping ${logSafe(configFile)} — not inside the workspace`);
        continue;
      }

      const config = readTurboConfig(resolve(workspaceRoot, configFile), configFile);
      if (config === null) continue;

      const ctx = {
        rootProjectName,
        configFile,
        globalInputs: buildGlobalInputs(config),
        projectNameFor,
      };

      // A package config extending `//` inherits the root config's
      // globals — fold them (and the root config file itself) into the
      // nested targets' inputs so root edits re-hash them.
      if (!isRoot && config.extends.includes('//')) {
        const inherited = getRootConfig();
        if (inherited !== null) {
          ctx.globalInputs.push(...buildGlobalInputs(inherited), '{workspaceRoot}/turbo.json');
        }
      }

      if (isRoot) {
        rootConfig = config;
        const projects = inferRootConfig(config, getPackages(), rootPkg, ctx);
        if (Object.keys(projects).length > 0) {
          results.push([configFile, { projects }]);
        }
      } else {
        const ownPkg = readPackageRef(workspaceRoot, dir);
        if (ownPkg === null) {
          logDebug(
            PLUGIN_SCOPE,
            `Skipping ${logSafe(configFile)} — no package.json in ${logSafe(dir)}`,
          );
          continue;
        }
        const projects = inferNestedConfig(config, ownPkg, ctx);
        if (Object.keys(projects).length > 0) {
          results.push([configFile, { projects }]);
        }
      }
    }

    return results;
  },
];

export default createNodesV2;

type ProjectMap = Record<
  string,
  Partial<Pick<ProjectConfiguration, 'root'>> & {
    targets?: Record<string, TargetConfiguration>;
  }
>;

/**
 * The root config's tasks fan out to workspace packages — and to the
 * root project for `//#` keys.
 */
function inferRootConfig(
  config: TurboJson,
  packages: WorkspacePackage[],
  rootPkg: PackageRef,
  ctx: Parameters<typeof buildTaskTarget>[2],
): ProjectMap {
  const byName = new Map(
    packages
      .filter((p): p is WorkspacePackage & { name: string } => p.name !== undefined)
      .map((p) => [p.name, p]),
  );
  const projects: ProjectMap = Object.create(null);

  for (const [key, task] of orderedTaskEntries(config.tasks)) {
    const sel = splitTaskKey(key);
    let candidates: PackageRef[];
    if (sel.package === '//') {
      candidates = [rootPkg];
    } else if (sel.package !== null) {
      const named = byName.get(sel.package);
      candidates = named === undefined ? [] : [named];
    } else {
      // A plain task applies to every workspace package — but never
      // to the root package (turbo requires `//#` there).
      candidates = packages;
    }

    for (const pkg of candidates) {
      addTarget(projects, pkg, sel.task, task, ctx);
    }
  }
  return projects;
}

/**
 * Task entries in merge order: plain tasks first, `pkg#task`/`//#task`
 * selector keys last — a scoped key overrides the same-named generic
 * target regardless of its position in the file.
 */
function orderedTaskEntries(tasks: TurboJson['tasks']): [string, TurboTask][] {
  const entries = Object.entries(tasks);
  return [
    ...entries.filter(([key]) => !key.includes('#')),
    ...entries.filter(([key]) => key.includes('#')),
  ];
}

/**
 * A nested config's tasks apply to its own package only. Selector keys
 * (`pkg#task`, `//#task`) are not allowed in package-level turbo.json —
 * any selector is dropped and the task lands on the owning package.
 */
function inferNestedConfig(
  config: TurboJson,
  ownPkg: PackageRef,
  ctx: Parameters<typeof buildTaskTarget>[2],
): ProjectMap {
  const projects: ProjectMap = Object.create(null);
  for (const [key, task] of orderedTaskEntries(config.tasks)) {
    const sel = splitTaskKey(key);
    addTarget(projects, ownPkg, sel.task, task, ctx);
  }
  return projects;
}

/**
 * Register a target when the package actually declares the script —
 * turbo runs a task only where the script exists.
 */
function addTarget(
  projects: ProjectMap,
  pkg: PackageRef,
  taskName: string,
  task: TurboTask,
  ctx: Parameters<typeof buildTaskTarget>[2],
): void {
  // A `//#` target needs a named root project to land on.
  if (pkg.root === '' && pkg.name === undefined) return;
  if (pkg.scripts[taskName] === undefined) {
    logDebug(PLUGIN_SCOPE, `No script '${logSafe(taskName)}' in ${logSafe(pkg.root || '.')}`);
    return;
  }
  let project = projects[pkg.root];
  if (project === undefined) {
    project = { root: pkg.root };
    projects[pkg.root] = project;
  }
  const targets: Record<string, TargetConfiguration> = project.targets ?? Object.create(null);
  project.targets = targets;
  targets[taskName] = buildTaskTarget(taskName, task, ctx);
  if (isVerbose()) {
    logDebug(PLUGIN_SCOPE, `Registered ${logSafe(pkg.root || '.')}:${logSafe(taskName)}`);
  }
}

/** The root package as a PackageRef — project root `''`. */
function readRootPackage(workspaceRoot: string): PackageRef {
  const pkg = readPackageJson(join(workspaceRoot, 'package.json'));
  return {
    root: '',
    name: typeof pkg?.name === 'string' && pkg.name !== '' ? pkg.name : undefined,
    scripts: readScripts(pkg),
  };
}

/**
 * The Nx project name of the workspace-root project — `project.json`
 * `name` wins, then `nx.json` `name`, then the root `package.json`.
 */
function readRootProjectName(
  workspaceRoot: string,
  pkgName: string | undefined,
): string | undefined {
  for (const file of ['project.json', 'nx.json']) {
    const name = readPackageJson(join(workspaceRoot, file))?.name;
    if (typeof name === 'string' && name !== '') return name;
  }
  return pkgName;
}

/**
 * package.json `name` → Nx project name. A package-level `project.json`
 * `name` wins over the manifest name; without one the manifest name is
 * the project name.
 */
function buildProjectNameMap(
  workspaceRoot: string,
  packages: WorkspacePackage[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const pkg of packages) {
    if (pkg.name === undefined) continue;
    const projectName = readPackageJson(join(workspaceRoot, pkg.root, 'project.json'))?.name;
    map.set(
      pkg.name,
      typeof projectName === 'string' && projectName !== '' ? projectName : pkg.name,
    );
  }
  return map;
}

/** The package.json of `dir`, or null when it cannot be read. */
function readPackageRef(workspaceRoot: string, dir: string): PackageRef | null {
  const pkg = readPackageJson(join(workspaceRoot, dir, 'package.json'));
  if (pkg === null) return null;
  return {
    root: dir,
    name: typeof pkg.name === 'string' && pkg.name !== '' ? pkg.name : undefined,
    scripts: readScripts(pkg),
  };
}

function readScripts(pkg: Record<string, unknown> | null): Record<string, string> {
  const scripts = pkg?.scripts;
  if (typeof scripts !== 'object' || scripts === null || Array.isArray(scripts)) {
    return {};
  }
  const out: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(scripts)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/**
 * `CreateNodesResult` cannot emit `targetDefaults`/`namedInputs` (Nx 24),
 * so turbo's `globalDependencies`/`globalEnv`/`globalDotEnv` fold into
 * every inferred target's inputs — equivalent hash semantics.
 * `globalPassThroughEnv` is left out on purpose: passthrough variables
 * are available to tasks but never hashed.
 */
function buildGlobalInputs(config: TurboJson): TaskInput[] {
  const inputs: TaskInput[] = [];
  inputs.push(...mapGlobs(config.globalDependencies, '{workspaceRoot}'));
  inputs.push(...mapGlobs(config.globalDotEnv, '{workspaceRoot}'));
  for (const name of config.globalEnv) {
    inputs.push({ env: name });
  }
  return inputs;
}

function readTurboConfig(absPath: string, configFile: string): TurboJson | null {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  try {
    return parseTurboJson(text, configFile);
  } catch {
    // A broken turbo.json must not break the project graph — warn and skip.
    logger.warn(`[${PLUGIN_SCOPE}] Could not parse ${logSafe(configFile)} — skipping it`);
    return null;
  }
}

/** node_modules and paths escaping the workspace are never packages. */
function isSkippedDir(dir: string): boolean {
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

export const __testing: { TURBO_GLOB: typeof TURBO_GLOB } = { TURBO_GLOB };
