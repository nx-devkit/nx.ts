import { describe, expect, it } from 'vitest'
import { initGenerator } from '../src/generators/init/generator.js'

function createTree(files: Record<string, string> = {}): {
  tree: import('@nx/devkit').Tree
  files: Map<string, string>
} {
  const fileMap = new Map<string, string>(Object.entries(files))

  const tree: import('@nx/devkit').Tree = {
    exists: (path: string) => fileMap.has(path),
    read: (path: string) => fileMap.get(path) ?? null,
    write: (path: string, content: string) => {
      fileMap.set(path, content)
    },
    delete: (path: string) => {
      fileMap.delete(path)
    },
    listChanges: () => [],
    rename: () => {},
    root: '/workspace',
  }

  return { tree, files: fileMap }
}

describe('@nx-devkit/typescript init generator', () => {
  it('registers the plugin in nx.json', async () => {
    const { tree, files } = createTree({
      'nx.json': JSON.stringify({ plugins: [] }),
    })

    await initGenerator(tree, {})

    const nxJson = JSON.parse(files.get('nx.json') ?? '{}')
    expect(nxJson.plugins).toContainEqual({
      options: {},
      plugin: '@nx-devkit/typescript',
    })
  })

  it('does not duplicate the plugin if already registered', async () => {
    const { tree, files } = createTree({
      'nx.json': JSON.stringify({
        plugins: [{ options: {}, plugin: '@nx-devkit/typescript' }],
      }),
    })

    await initGenerator(tree, {})

    const nxJson = JSON.parse(files.get('nx.json') ?? '{}')
    expect(nxJson.plugins).toHaveLength(1)
  })

  it('respects custom pluginPath', async () => {
    const { tree, files } = createTree({
      'nx.json': JSON.stringify({ plugins: [] }),
    })

    await initGenerator(tree, { pluginPath: './packages/typescript-preset/src/plugin.ts' })

    const nxJson = JSON.parse(files.get('nx.json') ?? '{}')
    expect(nxJson.plugins).toContainEqual({
      options: {},
      plugin: './packages/typescript-preset/src/plugin.ts',
    })
  })

  it('creates nx.json if it does not exist', async () => {
    const { tree, files } = createTree({})

    await initGenerator(tree, {})

    const nxJson = JSON.parse(files.get('nx.json') ?? '{}')
    expect(nxJson.plugins).toContainEqual({
      options: {},
      plugin: '@nx-devkit/typescript',
    })
  })

  it('throws on malformed nx.json instead of overwriting', async () => {
    const { tree } = createTree({
      'nx.json': '{ invalid json !!!',
    })

    await expect(initGenerator(tree, {})).rejects.toThrow(/Failed to parse nx\.json/)
  })
})
