import type { GeneratorCallback, Tree } from '@nx/devkit'
import { registerPlugin, resolveRootProjectName } from '@nx-devkit/internal'

export interface NxCloudInitOptions {
  pluginPath?: string
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/nx-cloud'

export async function initGenerator(
  tree: Tree,
  options: NxCloudInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath ?? DEFAULT_PLUGIN_PATH
  const projectName = resolveRootProjectName(tree) ?? '{root-project}'

  registerPlugin(tree, pluginPath)

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — the root project now has an \`nx-cloud-rotate\` target.`,
    '2. Rotate the Nx Cloud organization when the quota is exhausted:',
    `   bunx nx run ${projectName}:nx-cloud-rotate`,
    '3. Commit the updated nx.json — CI then points at the fresh org.',
    '4. Delete the old organization manually at https://cloud.nx.app (no public API exists).',
  ]
  for (const line of checklist) {
    console.log(line)
  }

  return () => {
    /* No-op */
  }
}

export default initGenerator
