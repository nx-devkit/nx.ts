import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreateNodesV2, ProjectConfiguration } from '@nx/devkit'

export interface NxPrepareForReleasePluginOptions {
  /** Path to the tools project that hosts the prepare-for-release target. */
  toolsProject?: string
  /** Target name inferred on the tools project. */
  targetName?: string
}

const PLUGIN_NAME = '@nx-devkit/prepare-for-release'

/**
 * Detect whether a directory is a release-bootstrap site: it contains a
 * `project.json` referencing the executor shipped by this plugin. Used by
 * `createNodesV2` to auto-wire a `prepare-for-release` target on the
 * `tools` project created by the init generator.
 */
export function isReleaseBootstrapProject(
  configFile: string,
  workspaceRoot: string,
  executor = `${PLUGIN_NAME}:publish-placeholder`,
): boolean {
  const projectRoot = join(workspaceRoot, configFile.replace(/\/project\.json$/, ''))
  const projectJsonPath = join(projectRoot, 'project.json')
  if (!existsSync(projectJsonPath)) return false
  try {
    const raw = JSON.parse(readFileSync(projectJsonPath, 'utf-8')) as Record<string, unknown>
    const targets = (raw.targets ?? {}) as Record<string, Record<string, unknown>>
    return Object.values(targets).some(
      (t) => typeof t.executor === 'string' && t.executor === executor,
    )
  } catch {
    return false
  }
}

export const createNodesV2: CreateNodesV2<NxPrepareForReleasePluginOptions> = [
  '**/project.json',
  (configFiles, _options, context) => {
    const results: Array<readonly [string, { projects: Record<string, ProjectConfiguration> }]> = []
    for (const configFile of configFiles) {
      const normalized = configFile.replace(/\\/g, '/')
      if (!isReleaseBootstrapProject(normalized, context.workspaceRoot)) continue
      const projectRoot = normalized.replace(/\/project\.json$/, '')
      if (projectRoot === '' || projectRoot === '.') continue
      results.push([
        configFile,
        {
          projects: {
            [projectRoot]: {
              targets: {
                'prepare-for-release': {
                  executor: `${PLUGIN_NAME}:publish-placeholder`,
                  options: {},
                },
              },
            },
          },
        },
      ])
    }
    return results
  },
]

export default { createNodesV2, name: PLUGIN_NAME }
