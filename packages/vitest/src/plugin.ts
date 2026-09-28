import { dirname, relative, resolve } from 'node:path'
import { type CreateNodesV2, logger } from '@nx/devkit'
import { inferVitestTargets, isVerbose, logDebug, shouldSkipPath } from '@nx-devkit/internal'

export { isVerbose }

const PLUGIN_SCOPE = 'nx-devkit/vitest'

export const createNodesV2: CreateNodesV2 = [
  '**/vitest.config.{ts,js,mts,mjs,cts,cjs}',
  (configFiles, _options, context) => {
    const verbose = isVerbose()
    const workspaceRootAbs = context.workspaceRoot
    if (verbose) {
      logger.info(`[${PLUGIN_SCOPE}] Processing ${configFiles.length} vitest config files`)
    }

    const seen = new Set<string>()
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

        return [
          configFile,
          {
            projects: {
              [projectRoot]: {
                targets: inferVitestTargets(projectRoot, configFile),
              },
            },
          },
        ] as const
      })
      .filter((entry) => entry !== null)
  },
]
