import { dirname, relative, resolve } from 'node:path'
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit'

export interface NxPlaywrightPluginOptions {
  /** Name of the e2e target. Default: "e2e". */
  targetName?: string
  /** Also infer `<targetName>:ui` and `<targetName>:update-snapshots`. Default: true. */
  extraTargets?: boolean
}

// Playwright auto-discovers playwright.config.* in the working directory.
const CONFIG_GLOB = '**/playwright.config.{ts,js,mts,mjs,cjs,cts}'

function shouldSkipDir(projectRoot: string, workspaceRoot: string): boolean {
  const rel = relative(workspaceRoot, resolve(workspaceRoot, projectRoot || '.'))
  if (rel === '') return false
  const segments = rel.split(/[\\/]/)
  return segments.includes('..') || segments.includes('node_modules')
}

export const createNodesV2: CreateNodesV2<NxPlaywrightPluginOptions> = [
  CONFIG_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot
    const targetName = options.targetName ?? 'e2e'
    const extraTargets = options.extraTargets ?? true

    // One target set per owning directory — the lexically first config wins.
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
      // Every playwright.config in the dir is an input so edits bust the cache.
      const configInputs = sorted.map((f) => `${prefix}/${dir ? f.slice(dir.length + 1) : f}`)

      const targets: Record<string, TargetConfiguration> = {
        [targetName]: {
          executor: 'nx:run-commands',
          cache: true,
          inputs: [`${prefix}/**/*`, ...configInputs],
          outputs: [
            '{projectRoot}/test-results',
            '{projectRoot}/playwright-report',
            '{projectRoot}/blob-report',
          ],
          options: { command: 'npx playwright test', cwd: '{projectRoot}' },
        },
      }
      if (extraTargets) {
        targets[`${targetName}:ui`] = {
          executor: 'nx:run-commands',
          cache: false,
          options: { command: 'npx playwright test --ui', cwd: '{projectRoot}' },
        }
        targets[`${targetName}:update-snapshots`] = {
          executor: 'nx:run-commands',
          cache: false,
          options: { command: 'npx playwright test --update-snapshots', cwd: '{projectRoot}' },
        }
      }

      results.push([winner, { projects: { [dir]: { root: dir, targets } } }])
    }
    return results
  },
]

export default createNodesV2
