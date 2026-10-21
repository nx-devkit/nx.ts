/**
 * Loading a sverka config into a Definition Graph.
 *
 * The config is a TypeScript module exporting a `Project` (or a bare
 * `Pipeline`). It is loaded with a dynamic `import()` — Node strips the
 * types (>= 22.18) and the config's own `@sverka/*` imports resolve
 * against the project, falling back to this plugin's bundled copies.
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { synthesize, type DefinitionGraph } from '@sverka/workflow'
import { registerConfigHooks } from './config-hooks.js'

/** Config file names looked for, in priority order. */
export const SVERKA_CONFIG_NAMES = [
  'sverka.config.ts',
  'sverka.config.mts',
  'sverka.config.js',
  'sverka.config.mjs',
] as const

/**
 * Find the sverka config in `dir`.
 *
 * Returns the absolute path of the first config file present, or `null`.
 */
export function findSverkaConfig(dir: string): string | null {
  for (const name of SVERKA_CONFIG_NAMES) {
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Load a sverka config file and synthesize its Definition Graph.
 *
 * The import URL carries the config's mtime so a long-lived process (the
 * Nx daemon) re-evaluates the config after it changes instead of serving
 * the stale module instance from the ESM cache.
 */
export async function loadDefinitionGraph(configPath: string): Promise<DefinitionGraph> {
  await registerConfigHooks()

  // Markdown authoring (`.sverka/*.md`) parses through the SDK.
  if (configPath.endsWith('.md')) {
    const { loadMarkdownFile } = await import('@sverka/sdk')
    const project = await loadMarkdownFile(configPath)
    return synthesize(project)
  }

  const url = `${pathToFileURL(configPath).href}?v=${cacheBust(configPath)}`
  const mod = (await import(url)) as Record<string, unknown>
  const construct = mod.project ?? mod.default
  if (!construct || typeof construct !== 'object') {
    throw new Error(
      `sverka config ${configPath} must export a Project or Pipeline (default or named "project")`,
    )
  }
  return synthesize(construct as Parameters<typeof synthesize>[0])
}

/** mtime-based cache buster for the config module URL. */
function cacheBust(configPath: string): string {
  try {
    return String(statSync(configPath).mtimeMs)
  } catch {
    return '0'
  }
}
