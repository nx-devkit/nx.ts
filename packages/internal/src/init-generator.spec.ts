import type { Tree } from '@nx/devkit'
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing'
import { describe, expect, it } from 'vitest'
import { installPeerDeps } from './init-generator.ts'

function createTree(pkg: Record<string, unknown> = {}): Tree {
  const tree = createTreeWithEmptyWorkspace({ formatter: 'none' })
  tree.write('package.json', JSON.stringify({ name: 'x', ...pkg }))
  return tree
}

function readPkg(tree: Tree): Record<string, Record<string, string>> {
  return JSON.parse(tree.read('package.json', 'utf8') ?? '{}') as Record<
    string,
    Record<string, string>
  >
}

describe('installPeerDeps', () => {
  it('adds missing deps to devDependencies', async () => {
    const tree = createTree()

    installPeerDeps(tree, { oxlint: '^1.0.0' })

    expect(readPkg(tree).devDependencies?.oxlint).toBe('^1.0.0')
  })

  it('skips deps already in dependencies or devDependencies', async () => {
    const tree = createTree({
      dependencies: { oxlint: '^1.0.0' },
      devDependencies: { eslint: '^9.0.0' },
    })

    installPeerDeps(tree, { eslint: '^9.0.0', knip: '^6.0.0', oxlint: '^1.0.0' })

    const pkg = readPkg(tree)
    expect(pkg.devDependencies?.knip).toBe('^6.0.0')
    expect(pkg.devDependencies?.eslint).toBe('^9.0.0')
    expect(pkg.dependencies?.oxlint).toBe('^1.0.0')
    expect('oxlint' in (pkg.devDependencies ?? {})).toBe(false)
  })

  it('returns a no-op callback when nothing is missing', () => {
    const tree = createTree({ devDependencies: { oxlint: '^1.0.0' } })
    const before = tree.read('package.json', 'utf8')

    const cb = installPeerDeps(tree, { oxlint: '^1.0.0' })

    expect(tree.read('package.json', 'utf8')).toBe(before)
    expect(() => cb()).not.toThrow()
  })
})
