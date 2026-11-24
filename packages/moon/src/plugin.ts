import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  logger,
  type CreateNodesResultArray,
  type CreateNodesV2,
  type ProjectConfiguration,
  type TargetConfiguration,
} from '@nx/devkit';
import { isVerbose, logDebug } from '@nx-devkit/internal';
import { parseMoonYml, type MoonProjectYml } from './moon-config.ts';
import { detectMoonWorkspace, type MoonWorkspace } from './workspace.ts';
import { buildTaskTarget, type TaskTargetContext } from './targets.ts';
import type { NxDevkitMoonOptions } from './types.ts';

const PLUGIN_SCOPE = 'nx-devkit/moon';

/**
 * Project-level moon config files — moon supports both extensions.
 * `.moon/workspace.{yml,yaml}` marks the workspace root; `moon.yml` in a
 * project dir is the project config this plugin reacts to.
 */
export const MOON_GLOB = '**/moon.{yml,yaml}';

/**
 * Infer Nx targets from moon.yml. Every `tasks:` entry becomes a target
 * on the project that owns the file — a `moon.yml` is already
 * project-scoped, so no workspace fan-out is needed. A stray moon.yml
 * without `.moon/workspace.*` still infers (it is a project file); when
 * `.moon/workspace.{yml,yaml}` or `.moon/toolchain.{yml,yaml}` exists it
 * is folded into every target's inputs and surfaced as metadata.
 */
export const createNodesV2: CreateNodesV2<NxDevkitMoonOptions> = [
  MOON_GLOB,
  (configFiles, options = {}, context): CreateNodesResultArray => {
    const workspaceRoot = context.workspaceRoot;
    const targetPrefix = options.targetPrefix ?? '';
    const moonWs = detectMoonWorkspace(workspaceRoot);
    const workspaceInputs = [moonWs.workspaceFile, moonWs.toolchainFile]
      .filter((file): file is string => file !== undefined)
      .map((file) => `{workspaceRoot}/${file}`);

    // First pass: normalize paths and parse every moon.yml once, so
    // second-pass resolution (same-dir dedupe, dependsOn id → Nx name)
    // can see the whole batch.
    const parsed: ParsedMoonConfig[] = [];
    for (const rawConfigFile of [...configFiles].sort()) {
      // Nx's glob expander can emit a leading "./" — normalize so the
      // path stays canonical in inputs and result keys.
      const configFile = rawConfigFile.startsWith('./') ? rawConfigFile.slice(2) : rawConfigFile;
      const dir = dirname(configFile).replace(/\\/g, '/');
      const root = dir === '.' ? '' : dir;
      if (isSkippedDir(root)) {
        logDebug(PLUGIN_SCOPE, `Skipping ${logSafe(configFile)} — not inside the workspace`);
        continue;
      }
      const config = readMoonConfig(resolve(workspaceRoot, configFile), configFile);
      if (config === null) continue;
      parsed.push({ configFile, root, config });
    }

    const projects = dedupeProjectRoots(parsed);
    const nameByMoonId = buildMoonIdNameMap(projects, moonWs, workspaceRoot);

    const results: CreateNodesResultArray = [];
    for (const { configFile, root, config } of projects) {
      const ctx: TaskTargetContext = {
        targetPrefix,
        projectRoot: root,
        configFile,
        projectEnv: config.env ?? {},
        fileGroups: config.fileGroups ?? {},
        workspaceInputs,
      };

      const targets: Record<string, TargetConfiguration> = Object.create(null);
      for (const [taskName, task] of Object.entries(config.tasks)) {
        targets[`${targetPrefix}${taskName}`] = buildTaskTarget(taskName, task, ctx);
      }

      const project = buildProject(root, config, targets, moonWs, nameByMoonId);
      if (project === null) continue;
      results.push([configFile, { projects: { [root]: project } }]);
      if (isVerbose()) {
        logDebug(
          PLUGIN_SCOPE,
          `Registered ${logSafe(root || '.')} — ${Object.keys(targets).length} target(s)`,
        );
      }
    }
    return results;
  },
];

export default createNodesV2;

interface ParsedMoonConfig {
  configFile: string;
  root: string;
  config: MoonProjectYml;
}

/**
 * One directory can hold both `moon.yml` and `moon.yaml` — moon treats
 * them as the same project. Emitting a result for each would make Nx
 * merge two sources of truth for one root, so keep one (`.yml` wins,
 * moon's canonical extension) and warn about the loser.
 */
function dedupeProjectRoots(parsed: ParsedMoonConfig[]): ParsedMoonConfig[] {
  const byRoot = new Map<string, ParsedMoonConfig>();
  for (const entry of parsed) {
    const prior = byRoot.get(entry.root);
    if (prior === undefined) {
      byRoot.set(entry.root, entry);
      continue;
    }
    const [winner, loser] = entry.configFile.endsWith('.yml') ? [entry, prior] : [prior, entry];
    byRoot.set(entry.root, winner);
    logger.warn(
      `[${PLUGIN_SCOPE}] ${logSafe(loser.configFile)} and ${logSafe(winner.configFile)} both define ${logSafe(winner.root || '.')} — using ${logSafe(winner.configFile)}`,
    );
  }
  return [...byRoot.values()];
}

/**
 * moon `dependsOn` lists moon project ids; Nx `implicitDependencies`
 * match project *names*. Map each id to the owning project's resolved
 * Nx name so `nx affected` / `^:task` deps land on real graph edges.
 * moon resolves a project's id from `id:`/string `project:` in its
 * moon.yml, the key in a map-form `.moon/workspace.*` `projects:`, or
 * the directory name for glob-sourced projects. The Nx name is the
 * explicit id/string `project`, else whatever `project.json`/
 * `package.json` declares, else the lowercase directory name — the same
 * order Nx applies when normalizing nameless plugin projects.
 */
function buildMoonIdNameMap(
  projects: ParsedMoonConfig[],
  moonWs: MoonWorkspace,
  workspaceRoot: string,
): Map<string, string> {
  const nameByMoonId = new Map<string, string>();
  for (const { root, config } of projects) {
    const explicit = config.id ?? (typeof config.project === 'string' ? config.project : undefined);
    const nxName = explicit ?? deriveNxName(root, workspaceRoot);
    if (nxName === undefined) continue;
    const ids = new Set<string>();
    const mapId = moonWs.projectIdsByRoot[root];
    if (mapId !== undefined) ids.add(mapId);
    if (explicit === undefined && mapId === undefined) {
      const dirName = root.split('/').pop();
      if (dirName !== undefined && dirName !== '') ids.add(dirName);
    }
    for (const id of ids) {
      if (id !== nxName && nameByMoonId.get(id) === undefined) nameByMoonId.set(id, nxName);
    }
  }
  return nameByMoonId;
}

/** The name Nx ends up with for a nameless moon project root. */
function deriveNxName(root: string, workspaceRoot: string): string | undefined {
  if (root === '') return undefined;
  for (const file of ['project.json', 'package.json']) {
    try {
      const json = JSON.parse(readFileSync(join(workspaceRoot, root, file), 'utf8')) as {
        name?: unknown;
      };
      if (typeof json.name === 'string' && json.name !== '') return json.name;
    } catch {
      // Missing or unreadable — fall through to the next source.
    }
  }
  const base = root.split('/').pop() ?? '';
  return base === '' ? undefined : base.toLowerCase();
}

type ProjectMap = Partial<ProjectConfiguration> & { root: string };

/**
 * Project-level fields: `id`/`project` → name, `tags` → tags, `type` →
 * projectType, `dependsOn` → implicitDependencies (so `^:task` deps and
 * `dependencies: true` resolve against real graph edges); moon project
 * ids are translated to Nx names via `nameByMoonId`, and unmatched ids
 * pass through unchanged — they may still name a project inferred by
 * another plugin. The `.moon/*` files and the language/stack metadata
 * ride in `metadata.moon`.
 */
function buildProject(
  root: string,
  config: MoonProjectYml,
  targets: Record<string, TargetConfiguration>,
  moonWs: MoonWorkspace,
  nameByMoonId: Map<string, string>,
): ProjectMap | null {
  const project: ProjectMap = { root };
  if (config.id !== undefined) {
    project.name = config.id;
  } else if (typeof config.project === 'string') {
    project.name = config.project;
  }
  if (config.tags !== undefined) project.tags = config.tags;
  const projectType = mapProjectType(config.type);
  if (projectType !== undefined) project.projectType = projectType;
  const implicitDeps = (config.dependsOn ?? [])
    .map((dep) => (typeof dep === 'string' ? dep : dep.id))
    .filter((id): id is string => typeof id === 'string' && id !== '')
    .map((id) => nameByMoonId.get(id) ?? id);
  if (implicitDeps.length > 0) project.implicitDependencies = implicitDeps;

  const moon = buildMoonMetadata(config, moonWs);
  if (Object.keys(moon).length > 0) project.metadata = { moon };
  if (Object.keys(targets).length > 0) project.targets = targets;

  // A moon.yml that maps to nothing (e.g. only invalid task entries and
  // no metadata) produces no project.
  const hasContent =
    Object.keys(targets).length > 0 ||
    project.name !== undefined ||
    project.tags !== undefined ||
    project.implicitDependencies !== undefined ||
    project.metadata !== undefined;
  return hasContent ? project : null;
}

/** `.moon/*` + language/stack metadata for `metadata.moon`. */
function buildMoonMetadata(config: MoonProjectYml, moonWs: MoonWorkspace): Record<string, unknown> {
  const moon: Record<string, unknown> = {};
  if (moonWs.workspaceFile !== undefined) moon.workspaceFile = moonWs.workspaceFile;
  if (moonWs.toolchainFile !== undefined) moon.toolchainFile = moonWs.toolchainFile;
  if (config.language !== undefined) moon.language = config.language;
  if (config.type !== undefined) moon.type = config.type;
  if (config.stack !== undefined) moon.stack = config.stack;
  if (typeof config.project === 'object' && config.project !== undefined) {
    moon.project = config.project;
  }
  return moon;
}

/** moon `type` → Nx `projectType`; moon-only kinds stay unset. */
function mapProjectType(type: string | undefined): 'application' | 'library' | undefined {
  if (type === 'application') return 'application';
  if (type === 'library') return 'library';
  return undefined;
}

function readMoonConfig(absPath: string, configFile: string): MoonProjectYml | null {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  try {
    return parseMoonYml(text, configFile);
  } catch {
    // A broken moon.yml must not break the project graph — warn and skip.
    logger.warn(`[${PLUGIN_SCOPE}] Could not parse ${logSafe(configFile)} — skipping it`);
    return null;
  }
}

/** node_modules and paths escaping the workspace are never projects. */
function isSkippedDir(root: string): boolean {
  if (root === '') return false;
  const segments = root.split('/');
  return segments.includes('..') || segments.includes('node_modules');
}

/** A config value, safe inside a single log line. */
function logSafe(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out +=
      code < 32 ||
      (code >= 127 && code < 160) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
        ? ' '
        : char;
  }
  return out.trim();
}

export const __testing: { MOON_GLOB: typeof MOON_GLOB } = { MOON_GLOB };
