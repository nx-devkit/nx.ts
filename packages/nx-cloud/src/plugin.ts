import { dirname } from 'node:path'
import type { CreateNodesV2, ProjectConfiguration } from '@nx/devkit'

export interface NxCloudPluginOptions {
  /** Target name inferred on the root project. */
  targetName?: string
}

const PLUGIN_NAME = '@nx-devkit/nx-cloud'

function isTestMode(): boolean {
  return process.env.NX_CACHE_PROJECT_GRAPH === 'false'
}

// --- Hoisted caches (disabled in test mode) ---
let nxCloudCache: Map<string, Record<string, unknown> | null> | null = new Map()

function getNxCloudCache(): Map<string, Record<string, unknown> | null> | null {
  return isTestMode() ? null : nxCloudCache
}

export const createNodesV2: CreateNodesV2<NxCloudPluginOptions> = [
  'nx.json',
  (configFiles, options = {}, _context) => {
    const targetName = options.targetName ?? 'nx-cloud-rotate'
    const results: (readonly [string, { projects: Record<string, ProjectConfiguration> }])[] = []

    // --- PERFORMANCE: Use hoisted cache ---
    const nxCloudMemCache = getNxCloudCache()
    const cacheKey = `nx-cloud-${targetName}`
    let targets = nxCloudMemCache?.get(cacheKey)

    if (targets === undefined) {
      targets = {
        [targetName]: {
          cache: false,
          executor: `${PLUGIN_NAME}:rotate`,
          options: {},
        },
      }
      nxCloudMemCache?.set(cacheKey, targets)
    }

    for (const configFile of configFiles) {
      const normalized = configFile.replace(/\\/g, '/')
      if (dirname(normalized) !== '.') {
        continue
      }
      results.push([
        configFile,
        {
          projects: {
            '.': {
              root: '.',
              targets: targets!,
            },
          },
        },
      ])
    }
    return results
  },
]

const plugin = { createNodesV2, name: PLUGIN_NAME }
export default plugin
