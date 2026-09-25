import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export {
  VITEST_CONFIG_NAMES,
  findConfigFile,
  findVitestConfig,
} from '@nx-devkit/internal'

export const OXLINTRC_NAMES = [
  '.oxlintrc.json',
  '.oxlintrc.jsonc',
  '.oxlintrc.yaml',
  '.oxlintrc.yml',
  '.oxlintrc.js',
  '.oxlintrc.mjs',
  '.oxlintrc.cjs',
  '.oxlintrc.ts',
  '.oxlintrc.mts',
  '.oxlintrc.cts',
]

export const ESLINT_CONFIG_NAMES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
]

export const BIOME_CONFIG_NAMES = ['biome.json', 'biome.jsonc']

export const TSDOWN_CONFIG_NAMES = [
  'tsdown.config.ts',
  'tsdown.config.js',
  'tsdown.config.mts',
  'tsdown.config.mjs',
  'tsdown.config.cts',
  'tsdown.config.cjs',
]

/**
 * Check if @typescript/native-preview is listed in the project's package.json.
 */
export async function checkNativePreview(
  projectRoot: string,
  workspaceRoot: string,
): Promise<boolean> {
  const absProjectRoot = resolve(workspaceRoot, projectRoot)
  const pkgPath = join(absProjectRoot, 'package.json')
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is the project's own package.json under an Nx project root
    const content = await readFile(pkgPath, 'utf8')
    const pkg = JSON.parse(content) as Record<string, unknown>
    const allDeps = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
      ...(pkg.peerDependencies as Record<string, string> | undefined),
    }
    return '@typescript/native-preview' in allDeps
  } catch {
    return false
  }
}
