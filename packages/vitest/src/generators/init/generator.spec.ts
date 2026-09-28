import type { Tree } from '@nx/devkit'
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing'
import { describe, expect, it } from 'vitest'
import { initGenerator } from './generator.ts'

// formatter: 'none' — no formatter config is seeded into the tree, so
// formatFiles detects nothing and generated content is asserted verbatim.
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
  it('registers @nx-devkit/vitest in nx.json plugins', async () => {
    const tree = createTree()

    await initGenerator(tree, {})

    const plugins = readPlugins(tree) as Array<{ plugin: string }>
    expect(plugins.some((p) => p.plugin === '@nx-devkit/vitest')).toBe(true)
  })

  it('does not duplicate the plugin entry on rerun', async () => {
    const tree = createTree()

    await initGenerator(tree, {})
    await initGenerator(tree, {})

    const plugins = readPlugins(tree) as Array<{ plugin: string }>
    expect(plugins.filter((p) => p.plugin === '@nx-devkit/vitest')).toHaveLength(1)
  })

  it('does not duplicate a string-form plugin entry', async () => {
    const tree = createTree()
    tree.write('nx.json', JSON.stringify({ plugins: ['@nx-devkit/vitest'] }))

    await initGenerator(tree, {})

    expect(readPlugins(tree)).toEqual(['@nx-devkit/vitest'])
  })

  it('honors a custom pluginPath', async () => {
    const tree = createTree()

    await initGenerator(tree, { pluginPath: './packages/vitest/src/plugin.ts' })

    const plugins = readPlugins(tree) as Array<{ plugin: string }>
    expect(plugins.some((p) => p.plugin === './packages/vitest/src/plugin.ts')).toBe(true)
  })

  it('preserves comments and formatting in nx.json', async () => {
    const tree = createTree()
    tree.write('nx.json', '{\n  // keep me\n  "plugins": ["other-plugin"]\n}\n')

    await initGenerator(tree, {})

    expect(tree.read('nx.json', 'utf8')).toBe(
      '{\n  // keep me\n  "plugins": [\n    "other-plugin",\n    {\n      "options": {},\n      "plugin": "@nx-devkit/vitest"\n    }\n  ]\n}\n',
    )
  })
})
