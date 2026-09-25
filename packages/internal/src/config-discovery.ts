import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const VITEST_CONFIG_NAMES = [
  'vitest.config.ts',
  'vitest.config.js',
  'vitest.config.mts',
  'vitest.config.mjs',
  'vitest.config.cts',
  'vitest.config.cjs',
]

export async function findConfigFile(
  projectRoot: string,
  workspaceRoot: string,
  candidates: string[],
): Promise<string | null> {
  const absProjectRoot = resolve(workspaceRoot, projectRoot)
  for (const name of candidates) {
    const candidate = join(absProjectRoot, name)
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- candidate names are fixed config basenames joined to an Nx project root
      await access(candidate)
      return candidate
    } catch {
      continue
    }
  }
  return null
}

export function findVitestConfig(
  projectRoot: string,
  workspaceRoot: string,
): Promise<string | null> {
  return findConfigFile(projectRoot, workspaceRoot, VITEST_CONFIG_NAMES)
}
