import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { logger, type CreateNodesV2 } from '@nx/devkit'
import { isVerbose, logDebug } from '@nx-devkit/internal'
import type { NxBoundariesOptions } from './types.ts'

const PLUGIN_NAME = '@nx-devkit/boundaries'

function hasTags(packageJsonPath: string): boolean {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a workspace package.json matched by the createNodesV2 glob
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>
    const nx = pkg.nx as Record<string, unknown> | undefined
    return Array.isArray(nx?.tags) && nx.tags.length > 0
  } catch {
    return false
  }
}

export const createNodesV2: CreateNodesV2<NxBoundariesOptions> = [
  '**/package.json',
  (configFiles, options = {}, context) => {
    const verbose = isVerbose()
    const targetName = options.targetName ?? 'check-boundaries'

    // Boundary checks are graph-global — a vacuous target in a tagless
    // workspace would be a false green. The trigger is at least one
    // non-root package.json carrying nx.tags.
    const anyTagged = configFiles.some((file) => {
      const normalized = file.replace(/\\/g, '/')
      if (dirname(normalized) === '.') {
        return false
      }
      return hasTags(join(context.workspaceRoot, file))
    })

    if (!anyTagged) {
      logDebug(PLUGIN_NAME, 'No project declares nx.tags — no target inferred')
      return []
    }

    const rootPkg = configFiles.find((f) => dirname(f.replace(/\\/g, '/')) === '.')
    if (!rootPkg) {
      return []
    }

    if (verbose) {
      logger.info(`[${PLUGIN_NAME}] Inferring ${targetName} on the workspace root`)
    }

    return [
      [
        rootPkg,
        {
          projects: {
            '.': {
              root: '.',
              targets: {
                [targetName]: {
                  executor: `${PLUGIN_NAME}:check-boundaries`,
                  cache: true,
                  inputs: ['{projectRoot}/package.json', '{workspaceRoot}/nx.json'],
                  options: {
                    depConstraints: options.depConstraints ?? [],
                  },
                },
              },
            },
          },
        },
      ] as const,
    ]
  },
]

const plugin = { createNodesV2, name: PLUGIN_NAME }
export default plugin
