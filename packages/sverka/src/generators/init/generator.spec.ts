import type { Tree } from '@nx/devkit'
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing'
import { describe, expect, it } from 'vitest'
import { initGenerator } from './generator.ts'

// With formatter 'none' no formatter config is seeded into the tree, so
// formatFiles detects nothing and the generated content is asserted verbatim.
function createTree(): Tree {
  const tree = createTreeWithEmptyWorkspace({ formatter: 'none' })
  tree.write('nx.json', JSON.stringify({}))
  return tree
}

function readPlugins(tree: Tree): unknown[] {
  const nxJson = JSON.parse(tree.read('nx.json', 'utf8') ?? '{}')
  return (nxJson.plugins as unknown[]) ?? []
}

describe('@nx-devkit/sverka:init', () => {
  it('registers the plugin in nx.json', async () => {
    const tree = createTree()

    await initGenerator(tree)

    const plugins = readPlugins(tree) as Array<{ plugin: string }>
    expect(plugins.some((entry) => entry.plugin === '@nx-devkit/sverka')).toBe(true)
  })

  it('installs the sverka peer dependency', async () => {
    const tree = createTree()
    tree.write('package.json', JSON.stringify({ name: 'x' }))

    await initGenerator(tree)

    const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}')
    expect(pkg.devDependencies['@sverka/workflow']).toBe('^0.2.28')
  })

  it('honours a custom plugin path', async () => {
    const tree = createTree()

    await initGenerator(tree, { pluginPath: './packages/sverka/src/plugin.ts' })

    const plugins = readPlugins(tree) as Array<{ plugin: string }>
    expect(plugins.some((entry) => entry.plugin === './packages/sverka/src/plugin.ts')).toBe(true)
  })

  it('does not register the plugin twice', async () => {
    const tree = createTree()

    await initGenerator(tree)
    await initGenerator(tree)

    const plugins = readPlugins(tree) as Array<{ plugin: string }>
    expect(plugins.filter((entry) => entry.plugin === '@nx-devkit/sverka')).toHaveLength(1)
  })

  it('keeps the other plugins in nx.json', async () => {
    const tree = createTree()
    tree.write('nx.json', JSON.stringify({ plugins: ['@nx-devkit/other'] }))

    await initGenerator(tree)

    const plugins = readPlugins(tree)
    expect(plugins).toContain('@nx-devkit/other')
  })
})
