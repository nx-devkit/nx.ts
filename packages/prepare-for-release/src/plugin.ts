import type { CreateNodesV2, ProjectConfiguration } from '@nx/devkit'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'

export interface NxPrepareForReleasePluginOptions {
  /** Path to the tools project that hosts the prepare-for-release target. */
  toolsProject?: string
  /** Target name inferred on the tools project. */
  targetName?: string
  /** Project-root prefixes excluded from per-package inference (e.g. ["fixtures"]). */
  exclude?: string[]
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
  const configDir = dirname(configFile)
  const projectRoot = isAbsolute(configDir) ? configDir : join(workspaceRoot, configDir)
  const projectJsonPath = join(projectRoot, 'project.json')
  if (!existsSync(projectJsonPath)) {
    return false
  }
  let contents: string
  try {
    contents = readFileSync(projectJsonPath, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return false
    throw error
  }
  try {
    const raw = JSON.parse(contents) as Record<string, unknown>
    const targets = (raw.targets ?? {}) as Record<string, Record<string, unknown>>
    return Object.values(targets).some(
      (t) => typeof t.executor === 'string' && t.executor === executor,
    )
  } catch (error) {
    if (error instanceof SyntaxError) return false
    throw error
  }
}

/**
 * Read a package.json and return its name when it is publishable
 * (has a `name` and is not `private: true`), otherwise null.
 */
export function publishablePackageName(configFile: string, workspaceRoot: string): string | null {
  const absPath = isAbsolute(configFile) ? configFile : join(workspaceRoot, configFile)
  let contents: string
  try {
    contents = readFileSync(absPath, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw error
  }
  try {
    const raw = JSON.parse(contents) as Record<string, unknown>
    if (typeof raw.name !== 'string' || raw.private === true) {
      return null
    }
    return raw.name
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

export const createNodesV2: CreateNodesV2<NxPrepareForReleasePluginOptions> = [
  '**/{package,project}.json',
  (configFiles, options = {}, context) => {
    const targetName = options.targetName ?? 'prepare-for-release'
    const toolsProjectRoot = options.toolsProject
      ?.replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/\/+$/, '')
    const exclude = (options.exclude ?? []).map((e) =>
      e.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, ''),
    )
    const results: (readonly [string, { projects: Record<string, ProjectConfiguration> }])[] = []
    for (const configFile of configFiles) {
      const normalized = configFile.replace(/\\/g, '/')
      const projectRoot = dirname(normalized).replace(/\/+$/, '')
      if (projectRoot === '' || projectRoot === '.' || projectRoot === context.workspaceRoot) {
        continue
      }
      if (basename(normalized) === 'project.json') {
        if (!isReleaseBootstrapProject(normalized, context.workspaceRoot)) {
          continue
        }
        if (toolsProjectRoot && projectRoot !== toolsProjectRoot) {
          continue
        }
        results.push([
          configFile,
          {
            projects: {
              [projectRoot]: {
                targets: {
                  [targetName]: {
                    executor: `${PLUGIN_NAME}:publish-placeholder`,
                    options: {},
                  },
                },
              },
            },
          },
        ])
        continue
      }
      // package.json — per-package inference so `nx run-many -t
      // prepare-for-release` processes each publishable package.
      if (!publishablePackageName(normalized, context.workspaceRoot)) {
        continue
      }
      if (
        exclude.some((prefix) => projectRoot === prefix || projectRoot.startsWith(`${prefix}/`))
      ) {
        continue
      }
      results.push([
        configFile,
        {
          projects: {
            [projectRoot]: {
              targets: {
                [targetName]: {
                  executor: `${PLUGIN_NAME}:publish-placeholder`,
                  options: { packageJson: normalized },
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

const plugin = { createNodesV2, name: PLUGIN_NAME }
export default plugin
