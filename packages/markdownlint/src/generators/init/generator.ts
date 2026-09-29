import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit'
import { installPeerDeps, registerPlugin, resolveRootProjectName } from '@nx-devkit/internal'

export interface NxMarkdownlintInitOptions {
  pluginPath?: string
}

const PEER_DEPS: Record<string, string> = { 'markdownlint-cli2': '^0.23.2' }

const DEFAULT_PLUGIN_PATH = '@nx-devkit/markdownlint'

export async function initGenerator(
  tree: Tree,
  options: NxMarkdownlintInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath || DEFAULT_PLUGIN_PATH
  const projectName = resolveRootProjectName(tree) ?? '{root-project}'

  registerPlugin(tree, pluginPath)
  const installDeps = installPeerDeps(tree, PEER_DEPS)

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — projects containing .markdownlint* configs now have lint-md targets.`,
    '2. Inspect inferred targets:',
    '   bunx nx show projects',
    `3. Run a target:  bunx nx run ${projectName}:lint-md`,
  ]
  for (const line of checklist) {
    console.log(line)
  }
  await formatFiles(tree)

  return () => installDeps()
}

export default initGenerator
