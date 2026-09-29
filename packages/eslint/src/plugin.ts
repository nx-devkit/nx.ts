import { dirname, relative, resolve } from 'node:path'
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit'

export interface NxEslintPluginOptions {
  /** Name of the lint target. Default: "lint". */
  targetName?: string
  /** Also infer a `<targetName>:fix` target (`eslint --fix`). Default: true. */
  fixTarget?: boolean
}

// Flat-config only — legacy .eslintrc.* is out of scope (eslint >=9 default).
const CONFIG_GLOB = '**/eslint.config.{js,mjs,cjs,ts,mts,cts}'

function shouldSkipDir(projectRoot: string, workspaceRoot: string): boolean {
  const rel = relative(workspaceRoot, resolve(workspaceRoot, projectRoot || '.'))
  if (rel === '') return false
  const segments = rel.split(/[\\/]/)
  return segments.includes('..') || segments.includes('node_modules')
}

export const createNodesV2: CreateNodesV2<NxEslintPluginOptions> = [
  CONFIG_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot
    const targetName = options.targetName ?? 'lint'
    const fixTarget = options.fixTarget ?? true

    // One target pair per owning directory — the lexically first config wins.
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

      const sorted = files.toSorted((a, b) => a.localeCompare(b))
      const winner = sorted.at(0)
      if (winner === undefined) continue

      const prefix = dir ? '{projectRoot}' : '{workspaceRoot}'
      // Every eslint.config in the dir is an input so edits bust the cache.
      const configInputs = sorted.map((f) => `${prefix}/${dir ? f.slice(dir.length + 1) : f}`)

      const targets: Record<string, TargetConfiguration> = {
        [targetName]: {
          executor: 'nx:run-commands',
          cache: true,
          inputs: [`${prefix}/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}`, ...configInputs],
          options: { command: 'npx eslint .', cwd: '{projectRoot}' },
        },
      }
      if (fixTarget) {
        targets[`${targetName}:fix`] = {
          executor: 'nx:run-commands',
          cache: false,
          options: { command: 'npx eslint . --fix', cwd: '{projectRoot}' },
        }
      }

      results.push([winner, { projects: { [dir]: { root: dir, targets } } }])
    }
    return results
  },
]

export default createNodesV2
