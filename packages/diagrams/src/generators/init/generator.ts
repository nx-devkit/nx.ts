import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit'
import { applyEdits, modify } from 'jsonc-parser'
import { detectIndent, parseJsonObject } from '../../jsonc.ts'

export interface NxDiagramsInitOptions {
  pluginPath?: string
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/diagrams'

function readJson(tree: Tree, path: string): Record<string, unknown> | null {
  if (!tree.exists(path)) {
    return null
  }
  const text = tree.read(path, 'utf8')
  if (text == null) {
    return null
  }
  return parseJsonObject(text, path)
}

function registerPlugin(tree: Tree, pluginPath: string): void {
  const text = tree.exists('nx.json') ? tree.read('nx.json', 'utf8') : null
  const nxJson = text == null ? {} : parseJsonObject(text, 'nx.json')
  const plugins = Array.isArray(nxJson.plugins) ? (nxJson.plugins as unknown[]) : []
  const alreadyRegistered = plugins.some(
    (entry) =>
      (typeof entry === 'string' && entry === pluginPath) ||
      (Array.isArray(entry) && entry[0] === pluginPath) ||
      (typeof entry === 'object' &&
        entry !== null &&
        !Array.isArray(entry) &&
        (entry as { plugin?: string }).plugin === pluginPath),
  )
  if (alreadyRegistered) {
    return
  }

  const entry = { options: {}, plugin: pluginPath }
  if (text == null) {
    tree.write('nx.json', `${JSON.stringify({ plugins: [entry] }, null, 2)}\n`)
    return
  }
  const formattingOptions = detectIndent(text)
  const updated = applyEdits(
    text,
    modify(
      text,
      Array.isArray(nxJson.plugins) ? ['plugins', plugins.length] : ['plugins'],
      Array.isArray(nxJson.plugins) ? entry : [entry],
      { formattingOptions, isArrayInsertion: true },
    ),
  )
  tree.write('nx.json', updated)
}

function resolveRootProjectName(tree: Tree): string | undefined {
  // Nx names the root project from project.json, then nx.json, then package.json.
  for (const path of ['project.json', 'nx.json', 'package.json']) {
    const name = readJson(tree, path)?.name
    if (typeof name === 'string' && name) {
      return name
    }
  }
  return undefined
}

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
