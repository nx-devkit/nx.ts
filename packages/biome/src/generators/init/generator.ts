import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit'
import { installPeerDeps, registerPlugin, resolveRootProjectName } from '@nx-devkit/internal'

export interface NxBiomeInitOptions {
  pluginPath?: string
}

const PEER_DEPS: Record<string, string> = { '@biomejs/biome': '^2.0.0' }

const DEFAULT_PLUGIN_PATH = '@nx-devkit/biome'

export async function initGenerator(
  tree: Tree,
  options: NxBiomeInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath || DEFAULT_PLUGIN_PATH
  const projectName = resolveRootProjectName(tree) ?? '{root-project}'

  registerPlugin(tree, pluginPath)
  const installDeps = installPeerDeps(tree, PEER_DEPS)

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — projects containing biome.json now have inferred targets.`,
    '2. Inspect inferred targets:',
    '   bunx nx show projects',
    `3. Run a target:  bunx nx run ${projectName}:format`,
  ]
  for (const line of checklist) {
    console.log(line)
  }
  await formatFiles(tree)

  return () => installDeps()
}

export default initGenerator
