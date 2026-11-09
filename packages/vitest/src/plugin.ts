import { dirname, relative, resolve } from 'node:path'
import { type CreateNodesV2, logger } from '@nx/devkit'
import { inferVitestTargets, isVerbose, logDebug, shouldSkipPath } from '@nx-devkit/internal'

export { isVerbose }

const PLUGIN_SCOPE = 'nx-devkit/vitest'

function isTestMode(): boolean {
  return process.env.NX_CACHE_PROJECT_GRAPH === 'false'
}

// --- Hoisted caches (disabled in test mode) ---
let vitestCache: Map<string, Record<string, unknown> | null> | null = new Map()

function getVitestCache(): Map<string, Record<string, unknown> | null> | null {
  return isTestMode() ? null : vitestCache
}

export const createNodesV2: CreateNodesV2 = [
  '**/vitest.config.{ts,js,mts,mjs,cts,cjs}',
  (configFiles, _options, context) => {
    const verbose = isVerbose()
    const workspaceRootAbs = context.workspaceRoot
    if (verbose) {
      logger.info(`[${PLUGIN_SCOPE}] Processing ${configFiles.length} vitest config files`)
    }

    const seen = new Set<string>()

    // --- PERFORMANCE: Hoisted vitest cache (disabled in test mode) ---
    const vitestMemCache = getVitestCache()

    return configFiles
      .map((configFile) => {
        const dir = dirname(configFile)
        const dirAbs = resolve(workspaceRootAbs, dir)
        if (dirAbs === workspaceRootAbs) {
          return null
        }
        const projectRoot = relative(workspaceRootAbs, dirAbs).replace(/\\/g, '/')
        if (shouldSkipPath(projectRoot, workspaceRootAbs) || seen.has(projectRoot)) {
          return null
        }
        seen.add(projectRoot)
        logDebug(PLUGIN_SCOPE, `Found vitest config in ${projectRoot}`)

        // --- PERFORMANCE: Use hoisted cache ---
        const cacheKey = `${projectRoot}-${configFile}`
        let targets = vitestMemCache?.get(cacheKey)

        if (targets === undefined) {
          targets = inferVitestTargets(projectRoot, configFile)
          vitestMemCache?.set(cacheKey, targets)
        }

        return [
          configFile,
          {
            projects: {
              [projectRoot]: {
                targets: targets!,
              },
            },
          },
        ] as const
      })
      .filter((entry) => entry !== null)
  },
]
