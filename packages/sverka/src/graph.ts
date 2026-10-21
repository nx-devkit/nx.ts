/**
 * Loading a sverka config into a Definition Graph.
 *
 * The config is a TypeScript module exporting a `Project` (or a bare
 * `Pipeline`). It is loaded with a dynamic `import()` — Node strips the
 * types (>= 22.18) and the config's own `@sverka/*` imports resolve
 * against the project, falling back to this plugin's bundled copies.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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

  const url = `${pathToFileURL(configPath).href}?v=${configFingerprint(configPath)}`
  const mod = (await import(url)) as Record<string, unknown>
  const construct = mod.project ?? mod.default
  if (!construct || typeof construct !== 'object') {
    throw new Error(
      `sverka config ${configPath} must export a Project or Pipeline (default or named "project")`,
    )
  }
  return synthesize(construct as Parameters<typeof synthesize>[0])
}

/**
 * Fingerprint of the config and the local modules it imports.
 *
 * Exported for the spec — the fingerprint is what keeps a long-lived
 * process (the Nx daemon) from serving a stale graph.
 *
 * The ESM cache keeps every module under its own URL — busting the
 * config URL alone would leave an imported helper stale in a long-lived
 * process (the Nx daemon). The fingerprint covers the config and the
 * relative imports it pulls in, so a change to either re-evaluates them.
 */
export function configFingerprint(configPath: string): string {
  const parts: string[] = []
  collectFingerprint(configPath, parts, new Set(), 0)
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)
}

/** Collect the fingerprint parts of a file and its relative imports. */
function collectFingerprint(
  filePath: string,
  parts: string[],
  seen: Set<string>,
  depth: number,
): void {
  if (depth > MAX_IMPORT_DEPTH || seen.has(filePath)) return
  seen.add(filePath)

  let stat
  try {
    stat = statSync(filePath)
  } catch {
    return
  }
  parts.push(`${filePath}:${stat.mtimeMs}:${stat.size}`)

  let source: string
  try {
    source = readFileSync(filePath, 'utf8')
  } catch {
    return
  }

  for (const specifier of relativeImports(source)) {
    const resolved = resolveImport(dirname(filePath), specifier)
    if (!resolved) continue
    collectFingerprint(resolved, parts, seen, depth + 1)
  }
}

/** How deep the fingerprint follows relative imports. */
const MAX_IMPORT_DEPTH = 5

/** The relative module specifiers of a source file. */
function relativeImports(source: string): string[] {
  const specifiers: string[] = []
  const pattern = /(?:from|import)\s*['"](\.[^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1]
    if (!specifier) continue
    specifiers.push(specifier)
  }
  return specifiers
}

/**
 * Resolve a relative import to a file on disk.
 *
 * TypeScript sources import without an extension; the candidates are
 * tried in the order Node would resolve them.
 */
function resolveImport(fromDir: string, specifier: string): string | undefined {
  const base = resolve(fromDir, specifier)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.mts`,
    `${base}.js`,
    `${base}.mjs`,
    join(base, 'index.ts'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}
