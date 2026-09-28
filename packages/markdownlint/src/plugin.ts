import { basename, dirname, relative, resolve } from 'node:path'
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit'

export interface NxMarkdownlintPluginOptions {
  /** Name of the lint target. Default: "lint-md". */
  targetName?: string
  /** Name of the fix target, or false to disable. Default: "lint-md:fix". */
  fixTargetName?: string | false
  /**
   * Glob patterns to exclude from linting, emitted as `#`-negation globs.
   * Default: ["**\/*\/node_modules\/**"]. `.markdownlint-cli2.*` configs can
   * additionally enable `gitignore: true` for .gitignore-driven excludes.
   */
  ignoreGlobs?: string[]
}

const MARKDOWNLINT_GLOB = '**/.markdownlint*.{json,jsonc,yaml,yml,cjs,mjs}'

/** node_modules and path-escape segments are skipped; the workspace root is a valid owner. */
function shouldSkipConfig(configDir: string, workspaceRoot: string): boolean {
  const rel = relative(workspaceRoot, resolve(workspaceRoot, configDir))
  if (rel === '') return false // root config — repo-wide lint is the primary use
  const segments = rel.split(/[\\/]/)
  return segments.includes('..') || segments.includes('node_modules')
}

/**
 * `.markdownlint-cli2.*` is the cli2 options file (globs/gitignore/customModules) —
 * auto-discovered from cwd, never passed to `--config`. `.markdownlint.*` is the
 * rules config — passed via `--config` because cli2 does not auto-discover it.
 */
function isCli2Config(name: string): boolean {
  return name.startsWith('.markdownlint-cli2.')
}

/** POSIX single-quote escaping for values interpolated into the shell command. */
function sq(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * The command runs with cwd = the config's own directory (`{projectRoot}` or
 * `{workspaceRoot}`) so cli2 auto-discovers nested `.markdownlint-cli2.*`
 * runner configs. All paths are therefore relative to that directory.
 */
function buildCommand(rulesConfigName: string | null, ignoreGlobs: string[], fix: boolean): string {
  const parts = ['markdownlint-cli2']
  if (fix) parts.push('--fix')
  parts.push(sq('**/*.md'), ...ignoreGlobs.map((g) => sq(`#${g}`)))
  if (rulesConfigName) parts.push('--config', sq(rulesConfigName))
  return parts.join(' ')
}

function inferTarget(command: string, inputs: string[] | null): TargetConfiguration {
  return {
    executor: 'nx:run-commands',
    cache: inputs !== null,
    ...(inputs ? { inputs } : {}),
    options: { command, cwd: '{projectRoot}' },
  }
}

export const createNodesV2: CreateNodesV2<NxMarkdownlintPluginOptions> = [
  MARKDOWNLINT_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot
    const targetName = options.targetName ?? 'lint-md'
    const fixTargetName =
      options.fixTargetName === false ? null : (options.fixTargetName ?? 'lint-md:fix')
    const ignoreGlobs = options.ignoreGlobs ?? ['**/node_modules/**']

    // Group by owning directory: one project gets a single target set even when
    // both a cli2 config and a rules config coexist. Sorted for deterministic
    // output regardless of glob expansion order.
    const byDir = new Map<string, string[]>()
    for (const configFile of [...configFiles].sort()) {
      const dir = dirname(configFile).replace(/\\/g, '/')
      const list = byDir.get(dir) ?? []
      list.push(configFile)
      byDir.set(dir, list)
    }

    const results: Array<readonly [string, { projects: Record<string, ProjectConfiguration> }]> = []
    for (const [dir, files] of byDir) {
      const projectRoot = dir === '.' ? '' : dir
      if (shouldSkipConfig(projectRoot, workspaceRoot)) continue

      const rulesConfig = files.find((f) => !isCli2Config(basename(f)))
      const anchor = files.find((f) => isCli2Config(basename(f))) ?? files[0]
      if (anchor === undefined) continue

      const prefix = projectRoot ? '{projectRoot}' : '{workspaceRoot}'
      // Every config file in the directory is an input — editing either family
      // must invalidate the lint cache.
      const inputs = [`${prefix}/**/*.md`, ...files.map((f) => `${prefix}/${basename(f)}`)]

      // cwd {projectRoot} expands to the workspace root for the root project,
      // so both cases resolve to the config's own directory.
      const targets: Record<string, TargetConfiguration> = {
        [targetName]: inferTarget(
          buildCommand(rulesConfig ? basename(rulesConfig) : null, ignoreGlobs, false),
          inputs,
        ),
      }
      if (fixTargetName !== null) {
        targets[fixTargetName] = inferTarget(
          buildCommand(rulesConfig ? basename(rulesConfig) : null, ignoreGlobs, true),
          null,
        )
      }

      results.push([anchor, { projects: { [projectRoot]: { root: projectRoot, targets } } }])
    }
    return results
  },
]

export default createNodesV2

export const __testing = { buildCommand, isCli2Config, MARKDOWNLINT_GLOB }
