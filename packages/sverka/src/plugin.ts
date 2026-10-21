import { basename, dirname, relative, resolve } from 'node:path'
import type { CreateNodesResultArray, CreateNodesV2, TargetConfiguration } from '@nx/devkit'
import type { DefinitionGraph, StepDefinition } from '@sverka/workflow'
import { logger } from '@nx/devkit'
import { isVerbose, logDebug } from '@nx-devkit/internal'
import { SVERKA_CONFIG_NAMES, loadDefinitionGraph } from './graph.js'
import { collectEntries, stepsForEntry } from './plan.js'
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
    const verbose = isVerbose()
    const results: CreateNodesResultArray = []

    // One project per root: a directory may hold several config forms
    // (`sverka.config.ts` and `sverka.config.js`), and the one with the
    // highest precedence wins — the outcome must not depend on the order
    // the glob returned the files in.
    const byRoot = new Map<string, string[]>()
    for (const configFile of configFiles) {
      const dir = dirname(configFile).replace(/\\/g, '/')
      // The workspace root is the project root of a config in the root
      // directory — Nx names that project ''.
      const projectRoot = dir === '.' ? '' : dir
      if (isSkippedProjectRoot(projectRoot, context.workspaceRoot)) {
        logDebug(PLUGIN_SCOPE, `Skipping ${projectRoot}`)
        continue
      }
      const files = byRoot.get(projectRoot) ?? []
      files.push(configFile)
      byRoot.set(projectRoot, files)
    }

    for (const [projectRoot, files] of [...byRoot.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const configFile = pickConfig(files)
      const absConfig = resolve(context.workspaceRoot, configFile)
      let graph: DefinitionGraph
      try {
        graph = await loadDefinitionGraph(absConfig)
      } catch (error) {
        // A broken config must not break the whole project graph — report
        // it and leave the project without sverka targets.
        logger.warn(
          `[${PLUGIN_SCOPE}] could not load ${configFile}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        continue
      }

      const entries = collectEntries(graph)
      const selected = options.entry
        ? entries.filter((entry) => entry.id === options.entry)
        : entries

      if (selected.length === 0) {
        logger.warn(`[${PLUGIN_SCOPE}] no sverka entry "${options.entry}" in ${configFile}`)
        continue
      }

      const targets: Record<string, TargetConfiguration> = {}
      const allSteps = new Map<string, StepDefinition>()
      for (const entry of selected) {
        for (const step of stepsForEntry(graph, entry)) {
          allSteps.set(step.id, step)
        }
      }

      // The step a target name belongs to — a name may only be used once.
      const owners = new Map<string, string>()

      for (const entry of selected) {
        for (const step of stepsForEntry(graph, entry)) {
          let name = targetNameFor(step.id, options)
          const owner = owners.get(name)
          if (owner === step.id) {
            // A step reachable from two entries is inferred once — the
            // first entry wins, the targets are identical either way.
            continue
          }
          if (owner !== undefined) {
            // Two different steps render the same name (a template without
            // the pipeline, or two ids that sanitize to one). Report it and
            // keep the second step reachable under a unique name.
            const unique = uniqueName(name, owners)
            logger.warn(
              `[${PLUGIN_SCOPE}] target name "${name}" is used by both "${owner}" and "${step.id}" in ${configFile} — using "${unique}" for "${step.id}"`,
            )
            name = unique
          }
          owners.set(name, step.id)
          targets[name] = buildStepTarget(step, entry.id, {
            projectRoot,
            // The config lives in the project root — the target input is
            // relative to the project, not to the workspace.
            configFile: basename(configFile),
            graph,
            options,
            allSteps: [...allSteps.values()],
          })
          if (verbose) {
            logDebug(PLUGIN_SCOPE, `Registered ${projectRoot}:${name}`)
          }
        }
      }

      results.push([configFile, { projects: { [projectRoot]: { root: projectRoot, targets } } }])
    }

    return results
  },
]

export default createNodesV2

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
