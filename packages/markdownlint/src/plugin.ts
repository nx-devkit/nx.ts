import { basename, dirname, relative, resolve } from 'node:path'
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit'

export interface NxMarkdownlintPluginOptions {
  /** Name of the lint target. Default: "lint-md". */
  targetName?: string
  /** Name of the fix target, or false to disable. Default: "<targetName>:fix". */
  fixTargetName?: string | false
  /**
   * Glob patterns to exclude from linting, emitted as `#`-negation globs.
   * Default: ["**\/*\/node_modules\/**"]. `.markdownlint-cli2.*` configs can
   * additionally enable `gitignore: true` for .gitignore-driven excludes.
   */
  ignoreGlobs?: string[]
}

const MARKDOWNLINT_GLOB = '**/.markdownlint*.{json,jsonc,yaml,yml,cjs,mjs}'

/**
 * Auto-discovery names per markdownlint-cli2 docs. Names outside these lists
 * (e.g. `.markdownlint-cli2.json`, `.markdownlintrc.json`) are never honored by
 * the CLI, so a directory containing only those must not infer a target that
 * would silently ignore them.
 */
const CLI2_PRECEDENCE = [
  '.markdownlint-cli2.jsonc',
  '.markdownlint-cli2.yaml',
  '.markdownlint-cli2.cjs',
  '.markdownlint-cli2.mjs',
]
const RULES_PRECEDENCE = [
  '.markdownlint.jsonc',
  '.markdownlint.json',
  '.markdownlint.yaml',
  '.markdownlint.yml',
  '.markdownlint.cjs',
  '.markdownlint.mjs',
]

function pickByPrecedence(files: string[], precedence: string[]): string | undefined {
  const names = new Set(files.map((f) => basename(f)))
  return precedence.find((name) => names.has(name))
}

/** node_modules and path-escape segments are skipped; the workspace root is a valid owner. */
function shouldSkipConfig(configDir: string, workspaceRoot: string): boolean {
  const rel = relative(workspaceRoot, resolve(workspaceRoot, configDir))
  if (rel === '') return false // root config — repo-wide lint is the primary use
  const segments = rel.split(/[\\/]/)
  return segments.includes('..') || segments.includes('node_modules')
}

/** POSIX single-quote escaping for values interpolated into the shell command. */
function sq(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * The command runs with cwd = `{projectRoot}` (the config's own directory —
 * for the root project `{projectRoot}` resolves to the workspace root) so cli2
 * auto-discovers `.markdownlint-cli2.*` runner configs. All command paths are
 * therefore relative to that directory.
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

function inferDirectory(
  dir: string,
  files: string[],
  workspaceRoot: string,
  targetName: string,
  fixTargetName: string | null,
  ignoreGlobs: string[],
): readonly [string, { projects: Record<string, ProjectConfiguration> }] | null {
  const projectRoot = dir === '.' ? '' : dir
  if (shouldSkipConfig(projectRoot, workspaceRoot)) return null

  const rulesConfig = pickByPrecedence(files, RULES_PRECEDENCE)
  const cli2Config = pickByPrecedence(files, CLI2_PRECEDENCE)
  const anchor = cli2Config ?? rulesConfig
  if (anchor === undefined) return null

  const prefix = projectRoot ? '{projectRoot}' : '{workspaceRoot}'
  // Inputs cover every config under the linted tree: cli2 applies nested
  // per-directory configs, and gitignore:true reads .gitignore files —
  // any such edit must bust the lint cache.
  const inputs = [`${prefix}/**/*.md`, `${prefix}/**/.markdownlint*`, `${prefix}/**/.gitignore`]

  const targets: Record<string, TargetConfiguration> = {
    [targetName]: inferTarget(buildCommand(rulesConfig ?? null, ignoreGlobs, false), inputs),
  }
  if (fixTargetName !== null) {
    targets[fixTargetName] = inferTarget(buildCommand(rulesConfig ?? null, ignoreGlobs, true), null)
  }

  const anchorPath = dir === '.' ? anchor : `${dir}/${anchor}`
  return [anchorPath, { projects: { [projectRoot]: { root: projectRoot, targets } } }]
}

export const createNodesV2: CreateNodesV2<NxMarkdownlintPluginOptions> = [
  MARKDOWNLINT_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot
    const targetName = options.targetName ?? 'lint-md'
    const fixTargetName =
      options.fixTargetName === false ? null : (options.fixTargetName ?? `${targetName}:fix`)
    const ignoreGlobs = options.ignoreGlobs ?? ['**/node_modules/**']

    // Group by owning directory: one project gets a single target set even when
    // multiple config files coexist. Sorted for deterministic output order.
    const byDir = new Map<string, string[]>()
    for (const configFile of [...configFiles].sort()) {
      const dir = dirname(configFile).replace(/\\/g, '/')
      const list = byDir.get(dir) ?? []
      list.push(configFile)
      byDir.set(dir, list)
    }

    const results: Array<readonly [string, { projects: Record<string, ProjectConfiguration> }]> = []
    for (const [dir, files] of byDir) {
      const entry = inferDirectory(
        dir,
        files,
        workspaceRoot,
        targetName,
        fixTargetName,
        ignoreGlobs,
      )
      if (entry) results.push(entry)
    }
    return results
  },
]

export default createNodesV2

export const __testing = { buildCommand, CLI2_PRECEDENCE, RULES_PRECEDENCE, MARKDOWNLINT_GLOB }
