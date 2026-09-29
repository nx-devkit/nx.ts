import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit'

export interface NxKnipPluginOptions {
  /** Name of the knip target. Default: "knip". */
  targetName?: string
  /** Also infer a `<targetName>:fix` target (`knip --fix`). Default: true. */
  fixTarget?: boolean
}

// Standalone knip configs plus package.json carrying a "knip" key — knip auto-discovers all of them when run from the owning directory.
const KNIP_GLOB =
  '**/{knip.json,knip.jsonc,knip.ts,knip.config.ts,knip.config.js,knip.config.mjs,knip.config.cjs,package.json}'

// Deterministic precedence when several config forms live in one directory —
// Knip.json wins over everything else (matches knip's own discovery order).
const PRECEDENCE = [
  'knip.json',
  'knip.jsonc',
  'knip.ts',
  'knip.config.ts',
  'knip.config.js',
  'knip.config.mjs',
  'knip.config.cjs',
  'package.json',
]

function configRank(fileName: string): number {
  const idx = PRECEDENCE.indexOf(fileName)
  return idx === -1 ? PRECEDENCE.length : idx
}

function isKnipConfig(fileName: string): boolean {
  return configRank(fileName) < PRECEDENCE.length - 1
}

function hasKnipKey(absPath: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(absPath, 'utf8'))
    return typeof pkg === 'object' && pkg !== null && 'knip' in pkg
  } catch {
    return false
  }
}

function shouldSkipDir(projectRoot: string, workspaceRoot: string): boolean {
  const rel = relative(workspaceRoot, resolve(workspaceRoot, projectRoot || '.'))
  if (rel === '') return false
  const segments = rel.split(/[\\/]/)
  return segments.includes('..') || segments.includes('node_modules')
}

export const createNodesV2: CreateNodesV2<NxKnipPluginOptions> = [
  KNIP_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot
    const targetName = options.targetName ?? 'knip'
    const fixTarget = options.fixTarget ?? true

    // One target pair per owning directory — the highest-precedence config wins.
    const byDir = new Map<string, string[]>()
    for (const configFile of [...configFiles].sort()) {
      const dir = dirname(configFile).replace(/\\/g, '/')
      const key = dir === '.' ? '' : dir
      const list = byDir.get(key) ?? []
      list.push(configFile)
      byDir.set(key, list)
    }

    const results: Array<readonly [string, { projects: Record<string, ProjectConfiguration> }]> = []
    for (const [dir, files] of [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (shouldSkipDir(dir, workspaceRoot)) continue

      const sorted = files.sort(
        (a, b) => configRank(a.split('/').pop() ?? '') - configRank(b.split('/').pop() ?? ''),
      )
      const winner = sorted[0]
      const winnerName = winner.split('/').pop() ?? ''
      if (winnerName === 'package.json' && !hasKnipKey(resolve(workspaceRoot, winner))) continue

      const prefix = dir ? '{projectRoot}' : '{workspaceRoot}'
      // Every knip-bearing file in the dir must bust the cache — paths are relative to the project root ("" for the root project).
      const configInputs = sorted.map((f) => `${prefix}/${dir ? f.slice(dir.length + 1) : f}`)

      const targets: Record<string, TargetConfiguration> = {
        [targetName]: {
          executor: 'nx:run-commands',
          cache: true,
          inputs: [`${prefix}/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs,json,jsonc}`, ...configInputs],
          options: { command: 'npx knip', cwd: '{projectRoot}' },
        },
      }
      if (fixTarget) {
        targets[`${targetName}:fix`] = {
          executor: 'nx:run-commands',
          cache: false,
          options: { command: 'npx knip --fix', cwd: '{projectRoot}' },
        }
      }

      results.push([winner, { projects: { [dir]: { root: dir, targets } } }])
    }
    return results
  },
]

export default createNodesV2

export const __testing = { KNIP_GLOB, configRank, hasKnipKey, isKnipConfig }
