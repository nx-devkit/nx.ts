import type { Tree } from '@nx/devkit'
import { applyEdits, modify } from 'jsonc-parser'
import { detectIndent, parseJsonObject } from './jsonc.ts'

export function readJson(tree: Tree, path: string): Record<string, unknown> | null {
  if (!tree.exists(path)) {
    return null
  }
  const text = tree.read(path, 'utf8')
  if (text == null) {
    return null
  }
  return parseJsonObject(text, path)
}

/**
 * Registers `plugin` in nx.json as `{ plugin, options: {} }`, preserving
 * JSONC comments and the file's own indentation. Dedupes string, tuple,
 * and object plugin forms; creates nx.json when missing.
 */
export function registerPlugin(tree: Tree, pluginPath: string): void {
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

/** Nx names the root project from project.json, then nx.json, then package.json. */
export function resolveRootProjectName(tree: Tree): string | undefined {
  for (const path of ['project.json', 'nx.json', 'package.json']) {
    const name = readJson(tree, path)?.name
    if (typeof name === 'string' && name) {
      return name
    }
  }
  return undefined
}
