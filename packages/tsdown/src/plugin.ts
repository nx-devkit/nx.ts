import { dirname, relative, resolve } from 'node:path'
import { type CreateNodesV2, logger } from '@nx/devkit'
import { isVerbose, logDebug, shouldSkipPath } from '@nx-devkit/internal'

export { isVerbose }

const PLUGIN_SCOPE = 'nx-devkit/tsdown'

function isTestMode(): boolean {
  return process.env.NX_CACHE_PROJECT_GRAPH === 'false'
}

// --- Hoisted caches (disabled in test mode) ---
let tsdownCache: Map<string, Record<string, unknown> | null> | null = new Map()

function getTsdownCache(): Map<string, Record<string, unknown> | null> | null {
  return isTestMode() ? null : tsdownCache
}

export const createNodesV2: CreateNodesV2 = [
  '**/tsdown.config.ts',
  (configFiles, _options, context) => {
    const verbose = isVerbose()
    const workspaceRootAbs = context.workspaceRoot
    if (verbose) {
      logger.info(`[${PLUGIN_SCOPE}] Processing ${configFiles.length} tsdown config files`)
    }

    // --- PERFORMANCE: Hoisted tsdown cache (disabled in test mode) ---
    const tsdownMemCache = getTsdownCache()

    return configFiles
      .map((configFile) => {
        const dir = dirname(configFile)
        const dirAbs = resolve(workspaceRootAbs, dir)
        if (dirAbs === workspaceRootAbs) {
          return null
        }
        const projectRoot = relative(workspaceRootAbs, dirAbs).replace(/\\/g, '/')
        if (shouldSkipPath(projectRoot, workspaceRootAbs)) {
          return null
        }
        logDebug(PLUGIN_SCOPE, `Found tsdown.config.ts in ${projectRoot}`)

        // --- PERFORMANCE: Use hoisted cache ---
        const cacheKey = `${projectRoot}-${configFile}`
        let targets = tsdownMemCache?.get(cacheKey)

        if (targets === undefined) {
          const buildTarget = {
            executor: 'nx:run-commands',
            options: {
              command: 'tsdown',
              cwd: projectRoot,
            },
            outputs: [`{projectRoot}/dist`],
            cache: true,
            inputs: [
              `{projectRoot}/src/**/*.ts`,
              `{projectRoot}/tsconfig.lib.json`,
              `{projectRoot}/tsdown.config.ts`,
              `{projectRoot}/package.json`,
            ],
            dependsOn: ['^build'],
          }
          targets = { build: buildTarget }
          tsdownMemCache?.set(cacheKey, targets)
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
      .filter((result): result is NonNullable<typeof result> => result !== null)
  },
]
