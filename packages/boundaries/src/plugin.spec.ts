import { vol } from 'memfs'
import type { CreateNodesContextV2 } from 'nx/src/devkit-exports'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNodesV2 } from './plugin.ts'

vi.mock('fs', async () => {
  const memfs = await import('memfs')
  return { ...memfs.fs, default: memfs.fs }
})

vi.mock('fs/promises', async () => {
  const memfs = await import('memfs')
  return { ...memfs.fs.promises, default: memfs.fs.promises }
})

function makeContext(): CreateNodesContextV2 {
  return {
    workspaceRoot: '/workspace',
    nxJsonConfiguration: {},
    turboConfig: undefined,
    projectGraph: { nodes: {}, dependencies: {} },
  } as unknown as CreateNodesContextV2
}

describe('@nx-devkit/boundaries createNodesV2', () => {
  beforeEach(() => {
    vol.reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.NX_VERBOSE_LOGGING
  })

  it('infers a root check-boundaries target when a project declares nx.tags', async () => {
    vol.fromJSON(
      {
        '/workspace/package.json': '{"name":"root"}',
        '/workspace/packages/app/package.json': '{"name":"app","nx":{"tags":["type:app"]}}',
      },
      '/',
    )
    const results = await createNodesV2[1](
      ['package.json', 'packages/app/package.json'],
      {},
      makeContext(),
    )
    expect(results).toHaveLength(1)
    const [configFile, project] = results[0]!
    expect(configFile).toBe('package.json')
    const root = project.projects!['.']!
    expect(root.targets).toHaveProperty('check-boundaries')
    expect(root.targets!['check-boundaries']!.executor).toBe(
      '@nx-devkit/boundaries:check-boundaries',
    )
  })

  it('emits no target when no project declares tags', async () => {
    vol.fromJSON(
      {
        '/workspace/package.json': '{"name":"root"}',
        '/workspace/packages/app/package.json': '{"name":"app"}',
      },
      '/',
    )
    const results = await createNodesV2[1](
      ['package.json', 'packages/app/package.json'],
      {},
      makeContext(),
    )
    expect(results).toHaveLength(0)
  })

  it('a root package.json with nx.tags alone does not trigger the target', async () => {
    vol.fromJSON({ '/workspace/package.json': '{"name":"root","nx":{"tags":["type:app"]}}' }, '/')
    const results = await createNodesV2[1](['package.json'], {}, makeContext())
    expect(results).toHaveLength(0)
  })

  it('passes depConstraints through to the target options', async () => {
    vol.fromJSON(
      {
        '/workspace/package.json': '{"name":"root"}',
        '/workspace/packages/app/package.json': '{"name":"app","nx":{"tags":["type:app"]}}',
      },
      '/',
    )
    const depConstraints = [{ sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:util'] }]
    const results = await createNodesV2[1](
      ['package.json', 'packages/app/package.json'],
      { depConstraints },
      makeContext(),
    )
    expect(results[0]![1].projects!['.']!.targets!['check-boundaries']!.options).toEqual({
      depConstraints,
    })
  })

  it('honors a custom targetName', async () => {
    vol.fromJSON(
      {
        '/workspace/package.json': '{"name":"root"}',
        '/workspace/packages/app/package.json': '{"name":"app","nx":{"tags":["t"]}}',
      },
      '/',
    )
    const results = await createNodesV2[1](
      ['package.json', 'packages/app/package.json'],
      { targetName: 'boundaries' },
      makeContext(),
    )
    expect(results[0]![1].projects!['.']!.targets).toHaveProperty('boundaries')
  })
})
