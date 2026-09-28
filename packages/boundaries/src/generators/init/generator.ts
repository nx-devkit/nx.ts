import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit'
import { registerPlugin, resolveRootProjectName } from '@nx-devkit/internal'

export interface NxBoundariesInitOptions {
  pluginPath?: string
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/boundaries'

export async function initGenerator(
  tree: Tree,
  options: NxBoundariesInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath || DEFAULT_PLUGIN_PATH
  const projectName = resolveRootProjectName(tree) ?? '{root-project}'

  registerPlugin(tree, pluginPath)

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — projects containing nx.tags now have inferred targets.`,
    '2. Inspect inferred targets:',
    '   bunx nx show projects',
    `3. Run a target:  bunx nx run ${projectName}:check-boundaries`,
  ]
  for (const line of checklist) {
    console.log(line)
  }
  await formatFiles(tree)

  return () => {
    /* No-op */
  }
}

export default initGenerator
