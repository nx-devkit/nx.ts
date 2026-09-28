import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit'

export interface NxOpenSpecPluginOptions {
  /** Name of the aggregate validate target. Default: "spec-validate". */
  targetName?: string
  /** Infer one `spec-validate:<change-id>` target per active change. Default: true. */
  perChange?: boolean
  /** Pass --strict to openspec validate. Default: true. */
  strict?: boolean
}

const OPENSPEC_GLOB = '**/openspec/config.yaml'

function shouldSkipConfig(configDir: string, workspaceRoot: string): boolean {
  const rel = relative(workspaceRoot, resolve(workspaceRoot, configDir))
  if (rel === '') return false
  const segments = rel.split(/[\\/]/)
  return segments.includes('..') || segments.includes('node_modules')
}

/** Active change ids = subdirectories of openspec/changes/ containing proposal.md. */
function listChangeIds(openspecDir: string): string[] {
  const changesDir = join(openspecDir, 'changes')
  if (!existsSync(changesDir)) return []
  return readdirSync(changesDir, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        e.name !== 'archive' &&
        existsSync(join(changesDir, e.name, 'proposal.md')),
    )
    .map((e) => e.name)
    .sort()
}

function sq(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`
}

function validateTarget(command: string, inputs: string[]): TargetConfiguration {
  return {
    executor: 'nx:run-commands',
    cache: true,
    inputs,
    options: { command, cwd: '{projectRoot}' },
  }
}

export const createNodesV2: CreateNodesV2<NxOpenSpecPluginOptions> = [
  OPENSPEC_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot
    const targetName = options.targetName ?? 'spec-validate'
    const perChange = options.perChange ?? true
    const strict = options.strict ?? true
    const strictFlag = strict ? ' --strict' : ''

    const results: Array<readonly [string, { projects: Record<string, ProjectConfiguration> }]> = []
    for (const configFile of [...configFiles].sort()) {
      const openspecDir = dirname(configFile).replace(/\\/g, '/')
      const parent = dirname(openspecDir).replace(/\\/g, '/')
      const projectRoot = parent === '.' ? '' : parent
      if (shouldSkipConfig(projectRoot === '' ? '.' : projectRoot, workspaceRoot)) continue

      const prefix = projectRoot ? '{projectRoot}' : '{workspaceRoot}'
      const specRoot = `${prefix}/openspec`
      const absOpenspecDir = resolve(workspaceRoot, openspecDir)

      const targets: Record<string, TargetConfiguration> = {
        [targetName]: validateTarget(`openspec validate --all${strictFlag}`, [`${specRoot}/**`]),
      }

      if (perChange) {
        for (const id of listChangeIds(absOpenspecDir)) {
          // Per-change inputs: only that change dir — editing change A does not re-validate change B.
          targets[`${targetName}:${id}`] = validateTarget(
            `openspec validate ${sq(id)}${strictFlag}`,
            [`${specRoot}/changes/${id}/**`],
          )
        }
      }

      results.push([configFile, { projects: { [projectRoot]: { root: projectRoot, targets } } }])
    }
    return results
  },
]

export default createNodesV2

export const __testing = { listChangeIds, OPENSPEC_GLOB }
