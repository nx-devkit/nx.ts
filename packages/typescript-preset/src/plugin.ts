import { basename, dirname, join, relative, resolve } from 'node:path'
import type { CreateNodesResult, CreateNodesV2, TargetConfiguration } from '@nx/devkit'
import { createNodesFromFiles, createProjectGraphAsync, joinPathFragments } from '@nx/devkit'
import {
  inferVitestTargets,
  isVerbose,
  logDebug,
  resetCachedEnv,
  shouldSkipPath,
} from '@nx-devkit/internal'
import {
  BIOME_CONFIG_NAMES,
  checkNativePreview,
  ESLINT_CONFIG_NAMES,
  findConfigFile,
  findVitestConfig,
  OXLINTRC_NAMES,
  TSDOWN_CONFIG_NAMES,
} from './config.js'
import { globMatchAsync } from './glob.js'
import {
  hasConfigFreeTsdownEntry,
  inferTsdownBuildTarget,
  inferTsdownWatchTarget,
} from './targets/build.js'
import { inferBiomeTargets } from './targets/format.js'
import { inferAllHuskyTargets } from './targets/husky.js'
import { inferEslintTarget, inferOxlintTarget } from './targets/lint.js'
import { inferNativeTestTargets } from './targets/native-test.js'
import { inferTypecheckTarget } from './targets/typecheck.js'
import type { NxDevkitTypescriptOptions } from './types.js'

export {
  inferVitestTargets,
  isVerbose,
  logDebug,
  resetCachedEnv,
  shouldSkipPath,
} from '@nx-devkit/internal'
export { expandBraces, globMatch, globMatchAsync, globToRegExp } from './glob.js'
export {
  hasConfigFreeTsdownEntry,
  inferTsdownBuildTarget,
  inferTsdownWatchTarget,
} from './targets/build.js'
export { inferBiomeTargets } from './targets/format.js'
export { inferEslintTarget, inferOxlintTarget } from './targets/lint.js'
export { inferNativeTestTargets } from './targets/native-test.js'
export { inferTypecheckTarget } from './targets/typecheck.js'
// Re-export everything for backward compatibility
export type { NxDevkitTypescriptOptions }
export type { SyncGeneratorResult } from 'nx/src/utils/sync-generators'

const PLUGIN_SCOPE = 'nx-typescript'

// Shared caches hoisted out of the per-file loop
// Disabled in test mode (NX_CACHE_PROJECT_GRAPH=false) for test isolation
let packageManagerCache: 'bun' | 'npm' | 'pnpm' | 'yarn' | null = null
let tsconfigCache: Map<string, unknown> | null = new Map()
let oxlintrcCache: Map<string, string | null> | null = new Map()
let eslintConfigCache: Map<string, string | null> | null = new Map()
let biomeConfigCache: Map<string, string | null> | null = new Map()
let tsdownConfigCache: Map<string, string | null> | null = new Map()
let vitestConfigCache: Map<string, string | null> | null = new Map()

function isTestMode(): boolean {
  return process.env.NX_CACHE_PROJECT_GRAPH === 'false'
}

function getTsconfigCache(): Map<string, unknown> | null {
  return isTestMode() ? null : tsconfigCache
}
function getOxlintrcCache(): Map<string, string | null> | null {
  return isTestMode() ? null : oxlintrcCache
}
function getEslintConfigCache(): Map<string, string | null> | null {
  return isTestMode() ? null : eslintConfigCache
}
function getBiomeConfigCache(): Map<string, string | null> | null {
  return isTestMode() ? null : biomeConfigCache
}
function getTsdownConfigCache(): Map<string, string | null> | null {
  return isTestMode() ? null : tsdownConfigCache
}
function getVitestConfigCache(): Map<string, string | null> | null {
  return isTestMode() ? null : vitestConfigCache
}

function detectPackageManager(workspaceRoot: string): 'bun' | 'npm' | 'pnpm' | 'yarn' {
  if (!isTestMode() && packageManagerCache) return packageManagerCache
  // Import dynamically to avoid top-level heavy imports
  const { existsSync } = require('node:fs')
  const pm = existsSync(join(workspaceRoot, 'bun.lock'))
    ? 'bun'
    : existsSync(join(workspaceRoot, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : existsSync(join(workspaceRoot, 'yarn.lock'))
        ? 'yarn'
        : 'npm'
  if (!isTestMode()) packageManagerCache = pm
  return pm
}

export const createNodesV2: CreateNodesV2<NxDevkitTypescriptOptions> = [
  '**/tsconfig*.json',
  async (configFiles, options = {}, context) => {
    // Dynamic imports to avoid loading @nx-devkit/internal at top level
    const { hashObject } = await import('nx/src/devkit-internals')
    const { PluginCache, calculateHashesForCreateNodes } = await import('@nx/devkit/internal')
    const { workspaceDataDirectory } = await import('nx/src/utils/cache-directory')
    const { isVerbose, logDebug, mapWithConcurrency, resetCachedEnv, shouldSkipPath } =
      await import('@nx-devkit/internal')

    const configFileName = options.configFile ?? 'tsconfig.json'
    const tsgo = options.tsgo ?? true
    const clean = options.clean ?? false
    const tap = options.tap ?? false
    const coverage = options.coverage ?? false
    const oxlint = options.oxlint ?? true
    const eslint = options.eslint ?? true
    const biome = options.biome ?? true
    const tsdown = options.tsdown ?? true
    const testGlob = options.testGlob ?? '**/*.test.{ts,js,mts,mjs}'
    const specGlob = options.specGlob ?? '**/*.spec.{ts,js,mts,mjs}'
    const workspaceRoot = context.workspaceRoot

    const filteredConfigFiles = configFiles.filter(
      (configFile) => basename(configFile) === configFileName,
    )

    // Root project semantics: the workspace root is a real project when
    // `includeRoot` is set, or automatically when it is the only config
    // detected (single-package repo). Auto-mode self-corrects — when
    // nested projects appear later, the root is skipped again without
    // any stale flag left in nx.json. An explicit `false` always wins.
    const hasNestedProjects = filteredConfigFiles.some((configFile) => {
      const projectRoot = dirname(configFile)
      return (
        resolve(workspaceRoot, projectRoot) !== resolve(workspaceRoot) &&
        !shouldSkipPath(projectRoot, workspaceRoot)
      )
    })
    const effectiveIncludeRoot =
      options.includeRoot === true || (options.includeRoot === undefined && !hasNestedProjects)

    logDebug(PLUGIN_SCOPE, `Detected ${filteredConfigFiles.length} ${configFileName} files`)

    // ---- PERFORMANCE: Disk cache for computed targets ----
    // Skip cache in test environments (NX_CACHE_PROJECT_GRAPH=false)
    const skipCache = process.env.NX_CACHE_PROJECT_GRAPH === 'false'
    const optionsHash = hashObject(options)
    const workspaceHash = hashObject({ workspaceRoot: context.workspaceRoot })
    const cachePath = join(
      workspaceDataDirectory,
      `nx-typescript-${optionsHash}-${workspaceHash}.hash`,
    )
    const targetsCache = skipCache
      ? { has: () => false, get: () => undefined, set: () => {}, writeToDisk: () => {} }
      : new PluginCache<Record<string, TargetConfiguration>>(cachePath)

    // Calculate hashes for each project root to enable cache invalidation
    const projectRoots = filteredConfigFiles.map((f) => dirname(f))
    const hashes = await calculateHashesForCreateNodes(
      projectRoots,
      options,
      context,
      projectRoots.map(() => [
        // Include lockfiles and referenced configs in hash
        'package-lock.json',
        'pnpm-lock.yaml',
        'yarn.lock',
        'bun.lock',
        '.oxlintrc.*',
        'eslint.config.*',
        'biome.json',
        'biome.jsonc',
        'tsdown.config.*',
        'vitest.config.*',
      ]),
    )

    try {
      const rawResults = await createNodesFromFiles(
        async (configFile, _options, _context, idx) => {
          const projectRoot = dirname(configFile)
          const isWorkspaceRoot = resolve(workspaceRoot, projectRoot) === resolve(workspaceRoot)

          if (
            shouldSkipPath(projectRoot, workspaceRoot) &&
            !(effectiveIncludeRoot && isWorkspaceRoot)
          ) {
            logDebug(PLUGIN_SCOPE, `Skipping ${projectRoot}`)
            return { projects: {} }
          }

          const projectKey = (
            relative(workspaceRoot, resolve(workspaceRoot, projectRoot)) || '.'
          ).replace(/\\/g, '/')

          logDebug(PLUGIN_SCOPE, `Registering targets for ${projectKey}`)

          const relProjectRoot = projectKey
          const hash = hashes[idx]

          // Check disk cache first
          if (targetsCache.has(hash)) {
            logDebug(PLUGIN_SCOPE, `Cache hit for ${projectKey}`)
            return {
              projects: {
                [projectKey]: { targets: targetsCache.get(hash)! },
              },
            }
          }

          // Compute targets (cache miss)
          const hasNativePreview = await checkNativePreview(projectRoot, workspaceRoot)

          const typecheckTarget = inferTypecheckTarget(
            relProjectRoot,
            { tsgo, configFile: configFileName, clean },
            hasNativePreview,
          )

          const targets: Record<string, TargetConfiguration> = {
            typecheck: typecheckTarget,
          }

          // Parallel config file loading
          const [
            vitestConfigPath,
            projectOxlintrc,
            rootOxlintrc,
            projectEslintConfig,
            rootEslintConfig,
            projectBiomeConfig,
            rootBiomeConfig,
            tsdownConfigPath,
          ] = await Promise.all([
            findVitestConfig(projectRoot, workspaceRoot),
            findConfigFile(projectRoot, workspaceRoot, OXLINTRC_NAMES),
            findConfigFile('.', workspaceRoot, OXLINTRC_NAMES),
            findConfigFile(projectRoot, workspaceRoot, ESLINT_CONFIG_NAMES),
            findConfigFile('.', workspaceRoot, ESLINT_CONFIG_NAMES),
            findConfigFile(projectRoot, workspaceRoot, BIOME_CONFIG_NAMES),
            findConfigFile('.', workspaceRoot, BIOME_CONFIG_NAMES),
            findConfigFile(projectRoot, workspaceRoot, TSDOWN_CONFIG_NAMES),
          ])

          const oxlintrcPath = projectOxlintrc ?? rootOxlintrc
          const oxlintOwnsLint = oxlint && oxlintrcPath !== null
          if (oxlintOwnsLint) {
            targets.lint = inferOxlintTarget(relProjectRoot)
            if (!projectOxlintrc) {
              targets.lint.inputs.push('{workspaceRoot}/.oxlintrc.*')
            }
          }

          if (!oxlintOwnsLint && eslint) {
            const eslintConfigPath = projectEslintConfig ?? rootEslintConfig
            if (eslintConfigPath) {
              targets.lint = inferEslintTarget(relProjectRoot)
              if (!projectEslintConfig) {
                targets.lint.inputs.push('{workspaceRoot}/eslint.config.*')
              }
            }
          }

          if (biome) {
            const biomeConfigPath = projectBiomeConfig ?? rootBiomeConfig
            if (biomeConfigPath) {
              const biomeProvidesLint = !oxlintOwnsLint && !('lint' in targets && targets.lint)
              const inferred = inferBiomeTargets(relProjectRoot, biomeProvidesLint)
              if (!projectBiomeConfig) {
                for (const t of Object.values(inferred)) {
                  t.inputs = [
                    ...t.inputs,
                    '{workspaceRoot}/biome.json',
                    '{workspaceRoot}/biome.jsonc',
                  ]
                }
              }
              Object.assign(targets, inferred)
            }
          }

          if (tsdown) {
            const hasTsdown =
              tsdownConfigPath ||
              (await hasConfigFreeTsdownEntry(resolve(workspaceRoot, projectRoot)))
            if (hasTsdown) {
              targets.build = inferTsdownBuildTarget(relProjectRoot)
              targets['build:watch'] = inferTsdownWatchTarget(relProjectRoot)
            }
          }

          // Vitest or native test
          if (vitestConfigPath) {
            Object.assign(targets, inferVitestTargets(relProjectRoot, vitestConfigPath))
          } else {
            const absProjectRoot = resolve(workspaceRoot, projectRoot)
            const hasTestFiles =
              (await globMatchAsync(absProjectRoot, testGlob)) ||
              (await globMatchAsync(absProjectRoot, specGlob))
            if (hasTestFiles) {
              Object.assign(
                targets,
                inferNativeTestTargets(relProjectRoot, { tap, coverage, testGlob, specGlob }),
              )
            }
          }

          // Husky git hooks support
          const husky = options.husky ?? false
          if (husky) {
            Object.assign(targets, inferAllHuskyTargets(relProjectRoot))
          }

          // Store in disk cache
          targetsCache.set(hash, targets)

          return {
            projects: {
              [projectKey]: { targets },
            },
          }
        },
        filteredConfigFiles,
        options,
        context,
      )
      // Filter out skipped entries (empty projects) to match original behavior
      return rawResults.filter(([, result]) => Object.keys(result.projects).length > 0)
    } finally {
      // Always persist cache, even if one file throws
      targetsCache.writeToDisk()
    }
  },
]
const plugin = { createNodesV2, name: 'nx-typescript' }
export default plugin
