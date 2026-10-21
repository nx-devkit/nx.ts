import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit'
import { installPeerDeps, registerPlugin, resolveRootProjectName } from '@nx-devkit/internal'

export interface NxDevkitSverkaInitOptions {
  /** Plugin path registered in nx.json. Default: `@nx-devkit/sverka`. */
  pluginPath?: string
}

/**
 * The sverka config imports `@sverka/workflow` — the package that provides
 * the `Project`/`Pipeline`/`ShellStep` constructs.
 */
const PEER_DEPS: Record<string, string> = { '@sverka/workflow': '^0.2.28' }

const DEFAULT_PLUGIN_PATH = '@nx-devkit/sverka'

export async function initGenerator(
  tree: Tree,
  options: NxDevkitSverkaInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath || DEFAULT_PLUGIN_PATH
  const projectName = resolveRootProjectName(tree) ?? '{root-project}'

  registerPlugin(tree, pluginPath)
  const installDeps = installPeerDeps(tree, PEER_DEPS)

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — projects with a sverka config get one target per sverka step.`,
    '2. Generate a sverka config from what the project already has:',
    `   bunx nx g @nx-devkit/sverka:config --project=${projectName}`,
    '3. Inspect the inferred targets:',
    '   bunx nx show projects --with-target',
    `4. Run a step:  bunx nx run ${projectName}:ci:lint`,
  ]
  for (const line of checklist) {
    console.log(line)
  }
  await formatFiles(tree)

  return () => installDeps()
}

export default initGenerator
