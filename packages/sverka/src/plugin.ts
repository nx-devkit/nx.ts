import { basename, dirname, relative, resolve } from 'node:path'
import type {
  CreateNodesContextV2,
  CreateNodesResult,
  CreateNodesResultArray,
  CreateNodesV2,
  TargetConfiguration,
} from '@nx/devkit'
import type { DefinitionGraph, StepDefinition } from '@sverka/workflow'
import { logger } from '@nx/devkit'
import { isVerbose, logDebug } from '@nx-devkit/internal'
import { SVERKA_CONFIG_NAMES, loadDefinitionGraph } from './graph.js'
import { collectEntries, stepsForEntry, type SverkaEntryRef } from './plan.js'
import { buildStepTarget, targetNameFor } from './targets.js'
import type { NxDevkitSverkaOptions } from './types.js'

const PLUGIN_SCOPE = 'nx-devkit/sverka'

/** Config files the plugin reacts to. */
export const SVERKA_GLOB =
  '**/{sverka.config.ts,sverka.config.mts,sverka.config.js,sverka.config.mjs}'

/**
 * Infer one Nx target per sverka step.
 *
 * The config's directory becomes the owning project; every step the
 * selected entries can reach becomes a target of its own, with its own
 * inputs, outputs and cache entry.
 */
export const createNodesV2: CreateNodesV2<NxDevkitSverkaOptions> = [
  SVERKA_GLOB,
  async (configFiles, options = {}, context): Promise<CreateNodesResultArray> => {
    const results: CreateNodesResultArray = []
    for (const [projectRoot, files] of groupByRoot(configFiles, context.workspaceRoot)) {
      const result = await inferProject(projectRoot, files, options, context)
      if (result) results.push(result)
    }
    return results
  },
]

export default createNodesV2

/**
 * Group the config files by the project root they belong to.
 *
 * A directory may hold several config forms (`sverka.config.ts` and
 * `sverka.config.js`); the one with the highest precedence wins — the
 * outcome must not depend on the order the glob returned the files in.
 */
function groupByRoot(configFiles: readonly string[], workspaceRoot: string): Map<string, string[]> {
  const byRoot = new Map<string, string[]>()
  for (const configFile of configFiles) {
    const dir = dirname(configFile).replace(/\\/g, '/')
    // The workspace root is the project root of a config in the root
    // directory — Nx names that project ''.
    const projectRoot = dir === '.' ? '' : dir
    if (isSkippedProjectRoot(projectRoot, workspaceRoot)) {
      logDebug(PLUGIN_SCOPE, `Skipping ${projectRoot}`)
      continue
    }
    const files = byRoot.get(projectRoot) ?? []
    files.push(configFile)
    byRoot.set(projectRoot, files)
  }
  return new Map([...byRoot.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

/**
 * Infer the targets of one project.
 *
 * Returns `null` when the config cannot be used — a broken config must
 * not break the whole project graph.
 */
async function inferProject(
  projectRoot: string,
  files: string[],
  options: NxDevkitSverkaOptions,
  context: CreateNodesContextV2,
): Promise<readonly [string, CreateNodesResult] | null> {
  const configFile = pickConfig(files)
  const absConfig = resolve(context.workspaceRoot, configFile)

  let graph: DefinitionGraph
  try {
    graph = await loadDefinitionGraph(absConfig)
  } catch (error) {
    logger.warn(
      `[${PLUGIN_SCOPE}] could not load ${logSafe(configFile)}: ${logSafe(
        error instanceof Error ? error.message : String(error),
      )}`,
    )
    return null
  }

  const selected = selectEntries(graph, options, configFile)
  if (!selected) return null

  const targets = buildTargets(graph, selected, projectRoot, configFile, options)
  if (isVerbose()) {
    for (const name of Object.keys(targets)) {
      logDebug(PLUGIN_SCOPE, `Registered ${projectRoot}:${name}`)
    }
  }

  return [configFile, { projects: { [projectRoot]: { root: projectRoot, targets } } }]
}

/**
 * The entries the targets are inferred for.
 *
 * `null` when the requested entry does not exist in the config.
 */
function selectEntries(
  graph: DefinitionGraph,
  options: NxDevkitSverkaOptions,
  configFile: string,
): SverkaEntryRef[] | null {
  const entries = collectEntries(graph)
  const selected = options.entry ? entries.filter((entry) => entry.id === options.entry) : entries

  if (selected.length === 0) {
    logger.warn(`[${PLUGIN_SCOPE}] no sverka entry "${options.entry}" in ${configFile}`)
    return null
  }
  return selected
}

/**
 * The target of every step the entries can reach.
 */
function buildTargets(
  graph: DefinitionGraph,
  selected: SverkaEntryRef[],
  projectRoot: string,
  configFile: string,
  options: NxDevkitSverkaOptions,
): Record<string, TargetConfiguration> {
  const targets: Record<string, TargetConfiguration> = {}
  // The step a target name belongs to — a name may only be used once.
  const owners = new Map<string, string>()
  const allSteps = reachableSteps(graph, selected)

  for (const entry of selected) {
    for (const step of stepsForEntry(graph, entry)) {
      const name = claimTargetName(step, owners, configFile, options)
      if (name === null) continue
      targets[name] = buildStepTarget(step, entry.id, {
        projectRoot,
        // The config lives in the project root — the target input is
        // relative to the project, not to the workspace.
        configFile: basename(configFile),
        graph,
        options,
        allSteps,
      })
    }
  }
  return targets
}

/**
 * Every step the entries can reach.
 */
function reachableSteps(graph: DefinitionGraph, selected: SverkaEntryRef[]): StepDefinition[] {
  const steps = new Map<string, StepDefinition>()
  for (const entry of selected) {
    for (const step of stepsForEntry(graph, entry)) {
      steps.set(step.id, step)
    }
  }
  return [...steps.values()]
}

/**
 * The target name of a step.
 *
 * A step reachable from two entries is inferred once. Two *different*
 * steps that render the same name are reported, and the second one keeps
 * a unique name instead of disappearing from the graph.
 *
 * Returns `null` when the step is already inferred.
 */
function claimTargetName(
  step: StepDefinition,
  owners: Map<string, string>,
  configFile: string,
  options: NxDevkitSverkaOptions,
): string | null {
  const name = targetNameFor(step.id, options)
  const owner = owners.get(name)
  if (owner === step.id) return null

  let unique = name
  if (owner !== undefined) {
    unique = uniqueName(name, owners)
    // The step ids and the file name come from the config file — untrusted
    // input. The warning stays static; the details are in the debug log.
    logger.warn(
      `[${PLUGIN_SCOPE}] two steps render the same target name — the second one gets a unique suffix`,
    )
    // Only the file name — the step ids come from the config file and
    // must not reach a log line.
    logDebug(
      PLUGIN_SCOPE,
      `target name collision in ${logSafe(configFile)} — the second step got a unique suffix`,
    )
  }
  owners.set(unique, step.id)
  return unique
}

/**
 * A value from the config file, safe to put into a log message.
 *
 * The config is untrusted input: a step id or a file name may carry
 * control characters, and a log line must stay one line.
 */
function logSafe(value: string): string {
  let out = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    out += code < 32 || code === 127 ? ' ' : char
  }
  return out.trim()
}

/**
 * Pick the config of a directory.
 *
 * The precedence follows `SVERKA_CONFIG_NAMES`: the first form that
 * exists in the directory wins.
 */
function pickConfig(files: string[]): string {
  const sorted = [...files].sort((a, b) => configRank(a) - configRank(b))
  const first = sorted[0]
  if (first === undefined) {
    throw new Error('no sverka config found')
  }
  return first
}

/** Precedence of a config file name (lower wins). */
function configRank(configFile: string): number {
  const name = basename(configFile)
  const index = SVERKA_CONFIG_NAMES.indexOf(name as (typeof SVERKA_CONFIG_NAMES)[number])
  return index === -1 ? SVERKA_CONFIG_NAMES.length : index
}

/**
 * A target name that is not taken yet.
 */
function uniqueName(name: string, owners: Map<string, string>): string {
  let counter = 2
  let candidate = `${name}-${counter}`
  while (owners.has(candidate)) {
    counter += 1
    candidate = `${name}-${counter}`
  }
  return candidate
}

/**
 * Skip configs that do not belong to a project of this workspace.
 *
 * Unlike the shared `shouldSkipPath` helper, the workspace root *is* a
 * valid project here — a sverka config commonly lives there.
 */
export function isSkippedProjectRoot(projectRoot: string, workspaceRoot: string): boolean {
  const rel = relative(workspaceRoot, resolve(workspaceRoot, projectRoot))
  if (!rel) return false
  const segments = rel.split(/[\\/]/)
  if (segments[0] === '..' || segments.includes('..')) return true
  if (segments.includes('node_modules')) return true
  return false
}

export const __testing = { SVERKA_GLOB, isSkippedProjectRoot }
