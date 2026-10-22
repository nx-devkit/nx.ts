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
    // A local plugin path has no generator reference — only a package
    // path can be invoked as `<plugin>:config`.
    ...(isPackagePath(pluginPath)
      ? [
          '2. Generate a sverka config from what the project already has:',
          `   bunx nx g ${pluginPath}:config --project=${projectName}`,
        ]
      : []),
    '3. Inspect the inferred targets:',
    `   bunx nx show project ${projectName} --json`,
    '4. Run a step of the generated config (the target names are <pipeline>:<step>):',
    `   bunx nx run ${projectName}:ci:lint   # when the config has a "lint" step`,
  ]
  for (const line of checklist) {
    console.log(line)
  }
  await formatFiles(tree)

  return () => installDeps()
}

/**
 * True for a plugin path that can be invoked as a generator
 * (`@nx-devkit/sverka:config`) — a local file path cannot.
 */
function isPackagePath(pluginPath: string): boolean {
  if (pluginPath.startsWith('.') || pluginPath.startsWith('/')) return false
  // A Windows path (`C:\…` or `\\host\share`) is a local path too.
  if (/^[A-Za-z]:[\\/]/.test(pluginPath)) return false
  if (pluginPath.startsWith('\\\\')) return false
  return true
}

export default initGenerator
