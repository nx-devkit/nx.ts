import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit'

export interface NxCommitlintPluginOptions {
  /** Name of the commitlint target. Default: "commitlint". */
  targetName?: string
  /** Arguments passed to `commitlint`. Default: "--last". Use "--edit .git/COMMIT_EDITMSG" for hook usage or "--from <ref>" in CI. */
  args?: string
}

// Cosmiconfig "commitlint" search places — commitlint auto-discovers all of them when run from the owning directory.
const COMMITLINT_GLOB =
  '**/{commitlint.config.js,commitlint.config.ts,commitlint.config.mjs,commitlint.config.cjs,commitlint.config.cts,.commitlintrc,.commitlintrc.json,.commitlintrc.yaml,.commitlintrc.yml,.commitlintrc.js,.commitlintrc.ts,.commitlintrc.mjs,.commitlintrc.cjs,.commitlintrc.cts,package.json}'

// Deterministic precedence when several config forms live in one directory —
// mirrors cosmiconfig's default search order (package.json first).
const PRECEDENCE = [
  'package.json',
  '.commitlintrc',
  '.commitlintrc.json',
  '.commitlintrc.yaml',
  '.commitlintrc.yml',
  '.commitlintrc.js',
  '.commitlintrc.ts',
  '.commitlintrc.mjs',
  '.commitlintrc.cjs',
  '.commitlintrc.cts',
  'commitlint.config.js',
  'commitlint.config.ts',
  'commitlint.config.mjs',
  'commitlint.config.cjs',
  'commitlint.config.cts',
]

function configRank(fileName: string): number {
  const idx = PRECEDENCE.indexOf(fileName)
  return idx === -1 ? PRECEDENCE.length : idx
}

function hasCommitlintKey(absPath: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(absPath, 'utf8'))
    return typeof pkg === 'object' && pkg !== null && 'commitlint' in pkg
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

export const createNodesV2: CreateNodesV2<NxCommitlintPluginOptions> = [
  COMMITLINT_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot
    const targetName = options.targetName ?? 'commitlint'
    const args = options.args ?? '--last'

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
        !hasCommitlintKey(resolve(workspaceRoot, winner))
      )
        continue

      const prefix = dir ? '{projectRoot}' : '{workspaceRoot}'
      // Every commitlint-bearing file in the dir is an input — paths are relative to the project root ("" for the root project).
      const configInputs = sorted.map((f) => `${prefix}/${dir ? f.slice(dir.length + 1) : f}`)

      // Not cached: the verdict depends on git history (HEAD / ref range), not file contents alone.
      const targets: Record<string, TargetConfiguration> = {
        [targetName]: {
          executor: 'nx:run-commands',
          cache: false,
          inputs: configInputs,
          options: { command: `npx commitlint ${args}`, cwd: '{projectRoot}' },
        },
      }

      results.push([winner, { projects: { [dir]: { root: dir, targets } } }])
    }
    return results
  },
]

export default createNodesV2

export const __testing = { COMMITLINT_GLOB, configRank, hasCommitlintKey }
