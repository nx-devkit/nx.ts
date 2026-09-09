import { type GeneratorCallback, type Tree } from '@nx/devkit'

export interface NxTypescriptInitOptions {
  pluginPath?: string
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/typescript'

function readJson(tree: Tree, path: string): Record<string, unknown> | null {
  if (!tree.exists(path)) {
    return null
  }
  try {
    return JSON.parse(tree.read(path, 'utf8') ?? '{}') as Record<string, unknown>
  } catch {
    return null
  }
}

function writeJson(tree: Tree, path: string, value: unknown): void {
  tree.write(path, `${JSON.stringify(value, null, 2)}\n`)
}

function registerPlugin(tree: Tree, pluginPath: string): void {
  const nxJson = readJson(tree, 'nx.json') ?? {}
  const plugins = Array.isArray(nxJson.plugins) ? (nxJson.plugins as unknown[]) : []
  const alreadyRegistered = plugins.some(
    (entry) =>
      (typeof entry === 'string' && entry === pluginPath) ||
      (typeof entry === 'object' &&
        entry !== null &&
        (entry as { plugin?: string }).plugin === pluginPath),
  )
  if (alreadyRegistered) {
    return
  }

  plugins.push({ options: {}, plugin: pluginPath })
  nxJson.plugins = plugins
  writeJson(tree, 'nx.json', nxJson)
}

export async function initGenerator(
  tree: Tree,
  options: NxTypescriptInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath ?? DEFAULT_PLUGIN_PATH

  registerPlugin(tree, pluginPath)

  const checklist = [
    '1. Install the plugin in the consuming workspace:',
    '   bun add -D @nx-devkit/typescript',
    '2. The plugin auto-detects tsconfig.json files and infers:',
    '   - typecheck (tsgo --build)',
    '   - test (vitest or native Node test runner)',
    '   - lint (oxlint > eslint > biome)',
    '   - format / format-check (biome)',
    '   - build / build:watch (tsdown)',
    '3. No project.json needed — targets are inferred from config files.',
  ]
  for (const line of checklist) {
    console.log(line)
  }

  return () => {
    /* No-op */
  }
}

export default initGenerator
