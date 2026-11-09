import { shouldSkipPath } from '@nx-devkit/internal'
import type { CreateNodesFunctionV2 } from 'nx/src/project-graph/plugins/public-api'
import type { CreateNodesV2 } from '@nx/devkit'

const PLUGIN_NAME = '@nx-devkit/biome'
const WORKSPACE_ROOT_MARKER = 'biome.json'

export interface BiomePluginOptions {
  formatCommand?: string
  formatCheckCommand?: string
  lintCommand?: string
}

export interface BiomeTargetOptions {
  command: string
  cwd: string
}

export interface BiomeTarget {
  executor: 'nx:run-commands'
  options: BiomeTargetOptions
  cache: boolean
  inputs: string[]
}

export interface BiomeProjectConfiguration {
  projects: Record<string, { targets: Record<string, BiomeTarget> }>
}

export type BiomeCreateNodesResult = ReadonlyArray<readonly [string, BiomeProjectConfiguration]>

function isWorkspaceRoot(configFilePath: string): boolean {
  const normalized = configFilePath.replaceAll('\\', '/').replace(/^\.\//, '')
  return normalized === WORKSPACE_ROOT_MARKER || normalized === 'biome.jsonc'
}

function inferBiomeTargets(
  projectRoot: string,
  configFileBasename: string,
  options: BiomePluginOptions | undefined,
): Record<string, BiomeTarget> {
  const formatCommand = options?.formatCommand ?? 'biome format --write .'
  const formatCheckCommand = options?.formatCheckCommand ?? 'biome format .'
  const lintCommand = options?.lintCommand ?? 'biome lint .'

  const configInput = `{projectRoot}/${configFileBasename}`
  const baseInputs: string[] = [configInput, '{projectRoot}/**/*']

  return {
    format: {
      executor: 'nx:run-commands',
      options: { command: formatCommand, cwd: projectRoot },
      cache: false,
      inputs: baseInputs,
    },
    'format-check': {
      executor: 'nx:run-commands',
      options: { command: formatCheckCommand, cwd: projectRoot },
      cache: true,
      inputs: baseInputs,
    },
    lint: {
      executor: 'nx:run-commands',
      options: { command: lintCommand, cwd: projectRoot },
      cache: true,
      inputs: baseInputs,
    },
  }
}

function isTestMode(): boolean {
  return process.env.NX_CACHE_PROJECT_GRAPH === 'false'
}

// --- Hoisted caches (disabled in test mode) ---
let biomeCache: Map<string, Record<string, BiomeTarget> | null> | null = new Map()

function getBiomeCache(): Map<string, Record<string, BiomeTarget> | null> | null {
  return isTestMode() ? null : biomeCache
}

const createNodesFn: CreateNodesFunctionV2<BiomePluginOptions> = (
  configFiles,
  options,
  context,
) => {
  const workspaceRoot = context.workspaceRoot.replaceAll('\\', '/')
  const results: Array<readonly [string, BiomeProjectConfiguration]> = []
  const seenRoots = new Set<string>()

  // --- PERFORMANCE: Hoisted biome cache (disabled in test mode) ---
  const biomeMemCache = getBiomeCache()

  for (const configFile of configFiles) {
    const normalized = configFile.replaceAll('\\', '/')

    if (isWorkspaceRoot(normalized)) {
      continue
    }

    const projectRoot = normalized.replace(/^\.\//, '').replace(/\/biome\.jsonc?$/, '')
    if (shouldSkipPath(projectRoot, workspaceRoot)) {
      continue
    }

    if (seenRoots.has(projectRoot)) {
      continue
    }
    seenRoots.add(projectRoot)

    const configFileBasename = normalized.split('/').pop() ?? 'biome.json'

    // --- PERFORMANCE: Use hoisted cache ---
    const cacheKey = `${projectRoot}-${configFileBasename}-${JSON.stringify(options)}`
    let targets = biomeMemCache?.get(cacheKey)

    if (targets === undefined) {
      targets = inferBiomeTargets(projectRoot, configFileBasename, options)
      biomeMemCache?.set(cacheKey, targets)
    }

    results.push([
      configFile,
      {
        projects: {
          [projectRoot]: {
            targets: targets!,
          },
        },
      },
    ])
  }

  return results
}

export const createNodesV2: CreateNodesV2<BiomePluginOptions> = ['**/biome.json{,c}', createNodesFn]

export default { createNodesV2, name: PLUGIN_NAME }
