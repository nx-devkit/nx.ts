import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit'
import { registerPlugin, resolveRootProjectName } from '@nx-devkit/internal'

export interface NxDiagramsInitOptions {
  pluginPath?: string
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/diagrams'

export async function initGenerator(
  tree: Tree,
  options: NxDiagramsInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath || DEFAULT_PLUGIN_PATH
  const projectName = resolveRootProjectName(tree) ?? '{root-project}'

  registerPlugin(tree, pluginPath)

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — projects containing diagram files now have per-file \`diagram-*\` targets and an aggregate \`diagrams\` target.`,
    '2. Render all diagrams in a project:',
    `   bunx nx run ${projectName}:diagrams`,
    '3. By default rendering goes through https://kroki.io — set options.krokiUrl to your self-hosted instance or configure options.commands for local renderers.',
    '4. Commit the generated images (or gitignore them if outputDir points at dist/).',
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
