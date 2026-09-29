import type { Tree } from '@nx/devkit'
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing'
import { describe, expect, it } from 'vitest'
import { initGenerator } from './generator.ts'

// With formatter 'none' no formatter config is seeded into the tree, so formatFiles detects nothing and generated content is asserted verbatim.
function createTree(): Tree {
  const tree = createTreeWithEmptyWorkspace({ formatter: 'none' })
  tree.write('nx.json', JSON.stringify({}))
  return tree
}

function readPlugins(tree: Tree): unknown[] {
  const nxJson = JSON.parse(tree.read('nx.json', 'utf8') ?? '{}')
  return (nxJson.plugins as unknown[]) ?? []
}

describe('initGenerator', () => {
  it('registers @nx-devkit/playwright in nx.json plugins', async () => {
    const tree = createTree()

    await initGenerator(tree, {})

    const plugins = readPlugins(tree) as Array<{ plugin: string }>
    expect(plugins.some((p) => p.plugin === '@nx-devkit/playwright')).toBe(true)
  })

  it('does not duplicate the plugin entry on rerun', async () => {
    const tree = createTree()

    await initGenerator(tree, {})
    await initGenerator(tree, {})

    const plugins = readPlugins(tree) as Array<{ plugin: string }>
    expect(plugins.filter((p) => p.plugin === '@nx-devkit/playwright')).toHaveLength(1)
  })

  it('does not duplicate a string-form plugin entry', async () => {
    const tree = createTree()
    tree.write('nx.json', JSON.stringify({ plugins: ['@nx-devkit/playwright'] }))

    await initGenerator(tree, {})

    expect(readPlugins(tree)).toEqual(['@nx-devkit/playwright'])
  })

  it('honors a custom pluginPath', async () => {
    const tree = createTree()

    await initGenerator(tree, { pluginPath: './packages/playwright/src/plugin.ts' })

    const plugins = readPlugins(tree) as Array<{ plugin: string }>
    expect(plugins.some((p) => p.plugin === './packages/playwright/src/plugin.ts')).toBe(true)
  })

  it('preserves comments and formatting in nx.json', async () => {
    const tree = createTree()
    tree.write('nx.json', '{\n  // keep me\n  "plugins": ["other-plugin"]\n}\n')

    await initGenerator(tree, {})

    expect(tree.read('nx.json', 'utf8')).toBe(
      '{\n  // keep me\n  "plugins": [\n    "other-plugin",\n    {\n      "options": {},\n      "plugin": "@nx-devkit/playwright"\n    }\n  ]\n}\n',
    )
  })

  it('installs the peer dependency into devDependencies', async () => {
    const tree = createTree()
    tree.write('package.json', JSON.stringify({ name: 'x' }))

    await initGenerator(tree, {})

    const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}')
    expect(pkg.devDependencies['@playwright/test']).toBe('^1.40.0')
  })
})
