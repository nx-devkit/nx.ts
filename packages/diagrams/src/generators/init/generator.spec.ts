import type { Tree } from '@nx/devkit'
import { describe, expect, it } from 'vitest'
import { initGenerator } from './generator.ts'

class MemTree {
  private files = new Map<string, string>()

  exists(path: string): boolean {
    return this.files.has(path)
  }

  read(path: string): string | null {
    return this.files.get(path) ?? null
  }

  write(path: string, content: string): void {
    this.files.set(path, content)
  }

  listChanges(): { path: string; type: string }[] {
    return [...this.files.keys()].map((path) => ({ path, type: 'CREATE' }))
  }
}

function createTree(): MemTree {
  const tree = new MemTree()
  tree.write('nx.json', JSON.stringify({}))
  return tree
}

async function captureLogs(run: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = []
  const original = console.log
  console.log = (msg: unknown) => {
    lines.push(String(msg))
  }
  try {
    await run()
  } finally {
    console.log = original
  }
  return lines
}

describe('initGenerator', () => {
  it('registers @nx-devkit/diagrams in nx.json plugins', async () => {
    const tree = createTree()

    await initGenerator(tree as unknown as Tree, {})

    const nxJson = JSON.parse(tree.read('nx.json') ?? '{}')
    const plugins = nxJson.plugins as Array<{ plugin: string }>
    expect(plugins.some((p) => p.plugin === '@nx-devkit/diagrams')).toBe(true)
  })

  it('does not duplicate the plugin entry on rerun', async () => {
    const tree = createTree()

    await initGenerator(tree as unknown as Tree, {})
    await initGenerator(tree as unknown as Tree, {})

    const nxJson = JSON.parse(tree.read('nx.json') ?? '{}')
    const plugins = nxJson.plugins as Array<{ plugin: string }>
    expect(plugins.filter((p) => p.plugin === '@nx-devkit/diagrams')).toHaveLength(1)
  })

  it('does not duplicate a string-form plugin entry', async () => {
    const tree = createTree()
    tree.write('nx.json', JSON.stringify({ plugins: ['@nx-devkit/diagrams'] }))

    await initGenerator(tree as unknown as Tree, {})

    const nxJson = JSON.parse(tree.read('nx.json') ?? '{}')
    expect(nxJson.plugins).toEqual(['@nx-devkit/diagrams'])
  })

  it('does not duplicate a tuple-form plugin entry', async () => {
    const tree = createTree()
    tree.write('nx.json', JSON.stringify({ plugins: [['@nx-devkit/diagrams', { format: 'png' }]] }))

    await initGenerator(tree as unknown as Tree, {})

    const nxJson = JSON.parse(tree.read('nx.json') ?? '{}')
    expect(nxJson.plugins).toEqual([['@nx-devkit/diagrams', { format: 'png' }]])
  })

  it('preserves existing plugin entries', async () => {
    const tree = createTree()
    tree.write('nx.json', JSON.stringify({ plugins: ['./packages/tsdown/src/plugin.ts'] }))

    await initGenerator(tree as unknown as Tree, {})

    const nxJson = JSON.parse(tree.read('nx.json') ?? '{}')
    const plugins = nxJson.plugins as unknown[]
    expect(plugins).toContain('./packages/tsdown/src/plugin.ts')
    expect(plugins).toHaveLength(2)
  })

  it('honors a custom pluginPath', async () => {
    const tree = createTree()

    await initGenerator(tree as unknown as Tree, {
      pluginPath: './packages/diagrams/src/plugin.ts',
    })

    const nxJson = JSON.parse(tree.read('nx.json') ?? '{}')
    const plugins = nxJson.plugins as Array<{ plugin: string }>
    expect(plugins.some((p) => p.plugin === './packages/diagrams/src/plugin.ts')).toBe(true)
  })

  it('creates nx.json when it is missing', async () => {
    const tree = new MemTree()

    await initGenerator(tree as unknown as Tree, {})

    const nxJson = JSON.parse(tree.read('nx.json') ?? '{}')
    const plugins = nxJson.plugins as Array<{ plugin: string }>
    expect(plugins.some((p) => p.plugin === '@nx-devkit/diagrams')).toBe(true)
  })

  it('prints the real root project name in the checklist', async () => {
    const tree = createTree()
    tree.write('package.json', JSON.stringify({ name: 'my-workspace' }))

    const lines = await captureLogs(async () => initGenerator(tree as unknown as Tree, {}))

    expect(lines.join('\n')).toContain('my-workspace:diagrams')
  })

  it('prefers project.json name over nx.json and package.json names', async () => {
    const tree = createTree()
    tree.write('project.json', JSON.stringify({ name: 'proj-name' }))
    tree.write('nx.json', JSON.stringify({ name: 'ws-name' }))
    tree.write('package.json', JSON.stringify({ name: 'pkg-name' }))

    const lines = await captureLogs(async () => initGenerator(tree as unknown as Tree, {}))

    expect(lines.join('\n')).toContain('proj-name:diagrams')
  })

  it('prefers nx.json name over package.json name for the root project', async () => {
    const tree = createTree()
    tree.write('nx.json', JSON.stringify({ name: 'ws-name' }))
    tree.write('package.json', JSON.stringify({ name: 'pkg-name' }))

    const lines = await captureLogs(async () => initGenerator(tree as unknown as Tree, {}))

    expect(lines.join('\n')).toContain('ws-name:diagrams')
  })

  it('detects indentation from a real property, not a quoted comment line', async () => {
    const tree = new MemTree()
    tree.write(
      'nx.json',
      '{\n  /*\n        "plugins": example\n  */\n  "plugins": ["other-plugin"]\n}\n',
    )

    await initGenerator(tree as unknown as Tree, {})

    // The emitted entry follows the real 2-space top-level indent,
    // Not the 8-space indent of the quoted block-comment line.
    expect(tree.read('nx.json')).toContain('\n    {\n      "options"')
  })

  it('preserves comments and formatting in nx.json', async () => {
    const tree = new MemTree()
    tree.write('nx.json', '{\n  // keep me\n  "plugins": ["other-plugin"]\n}\n')

    await initGenerator(tree as unknown as Tree, {})

    expect(tree.read('nx.json')).toBe(
      '{\n  // keep me\n  "plugins": [\n    "other-plugin",\n    {\n      "options": {},\n      "plugin": "@nx-devkit/diagrams"\n    }\n  ]\n}\n',
    )
  })
})
