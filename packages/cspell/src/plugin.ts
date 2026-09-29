import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit'

export interface NxCspellPluginOptions {
  /** Name of the spell-check target. Default: "spell". */
  targetName?: string
  /** Arguments passed to `cspell lint`. Default: ".". */
  args?: string
}

// Cspell config search places — cspell auto-discovers all of them when run from the owning directory.
const CSPELL_GLOB =
  '**/{cspell.json,cspell.config.js,cspell.config.cjs,cspell.config.mjs,cspell.config.ts,cspell.config.json,.cspell.json,cspell.yaml,cspell.yml,.cspell.yaml,.cspell.yml,package.json}'

// Deterministic precedence when several config forms live in one directory — mirrors cspell's documented search order.
const PRECEDENCE = [
  'package.json',
  'cspell.json',
  '.cspell.json',
  'cspell.config.json',
  'cspell.config.js',
  'cspell.config.cjs',
  'cspell.config.mjs',
  'cspell.config.ts',
  'cspell.yaml',
  'cspell.yml',
  '.cspell.yaml',
  '.cspell.yml',
]

function configRank(fileName: string): number {
  const idx = PRECEDENCE.indexOf(fileName)
  return idx === -1 ? PRECEDENCE.length : idx
}

function hasCspellKey(absPath: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(absPath, 'utf8'))
    return typeof pkg === 'object' && pkg !== null && 'cspell' in pkg
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

export const createNodesV2: CreateNodesV2<NxCspellPluginOptions> = [
  CSPELL_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot
    const targetName = options.targetName ?? 'spell'
    const args = options.args ?? '.'

    // One target per owning directory — the highest-precedence config wins.
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

      const sorted = files.toSorted(
        (a, b) => configRank(a.split('/').pop() ?? '') - configRank(b.split('/').pop() ?? ''),
      )
      const winner = sorted.at(0)
      if (winner === undefined) continue
      if (
        winner.split('/').pop() === 'package.json' &&
        !hasCspellKey(resolve(workspaceRoot, winner))
      )
        continue

      const prefix = dir ? '{projectRoot}' : '{workspaceRoot}'
      // Every cspell-bearing file in the dir is an input — paths are relative to the project root ("" for the root project).
      const configInputs = sorted.map((f) => `${prefix}/${dir ? f.slice(dir.length + 1) : f}`)

      // The verdict depends on project file contents — cacheable.
      const targets: Record<string, TargetConfiguration> = {
        [targetName]: {
          executor: 'nx:run-commands',
          cache: true,
          inputs: [`${prefix}/**/*`, ...configInputs],
          options: { command: `npx cspell lint ${args}`, cwd: '{projectRoot}' },
        },
      }

      results.push([winner, { projects: { [dir]: { root: dir, targets } } }])
    }
    return results
  },
]

export default createNodesV2

export const __testing = { CSPELL_GLOB, configRank, hasCspellKey }
