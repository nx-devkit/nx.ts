import { logger } from '@nx/devkit'
import { vol } from 'memfs'
import type { CreateNodesContextV2 } from 'nx/src/devkit-exports'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNodesV2 } from './plugin.ts'

vi.mock('fs', async () => {
  const memfs = await import('memfs')
  return {
    ...memfs.fs,
    default: memfs.fs,
  }
})

vi.mock('fs/promises', async () => {
  const memfs = await import('memfs')
  return {
    ...memfs.fs.promises,
    default: memfs.fs.promises,
  }
})

function makeContext(): CreateNodesContextV2 {
  return {
    workspaceRoot: '/workspace',
    nxJsonConfiguration: {},
    turboConfig: undefined,
    projectGraph: { nodes: {}, dependencies: {} },
  } as unknown as CreateNodesContextV2
}

describe('@nx-devkit/vitest createNodesV2', () => {
  beforeEach(() => {
    vol.reset()
    vol.fromJSON(
      {
        '/workspace/project-a/vitest.config.ts': 'export default {}',
        '/workspace/project-a/src/index.ts': 'export const a = 1',
        '/workspace/project-a/package.json': '{}',
        '/workspace/project-b/vitest.config.mts': 'export default {}',
        '/workspace/project-b/src/index.ts': 'export const b = 2',
        '/workspace/project-b/package.json': '{}',
        '/workspace/vitest.config.ts': 'export default {}',
        '/workspace/package.json': '{}',
      },
      '/',
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.NX_VERBOSE_LOGGING
    process.argv = process.argv.filter((a) => a !== '--verbose')
  })

  it('infers test targets for a project with vitest.config.ts', async () => {
    const [pattern, fn] = createNodesV2
    expect(pattern).toBe('**/vitest.config.{ts,js,mts,mjs,cts,cjs}')

    const results = await fn(['project-a/vitest.config.ts'], {}, makeContext())

    expect(results).toHaveLength(1)
    const [configFile, project] = results[0]!
    expect(configFile).toBe('project-a/vitest.config.ts')
    const targets = project.projects!['project-a']!.targets!
    expect(targets).toHaveProperty('test')
    expect(targets).toHaveProperty('test:watch')
    expect(targets).toHaveProperty('test:coverage')
  })

  it('test target uses nx:run-commands with vitest run, cache, dependsOn ^build', async () => {
    const [, fn] = createNodesV2
    const results = await fn(['project-a/vitest.config.ts'], {}, makeContext())
    const test = results[0]![1].projects!['project-a']!.targets!.test!

    expect(test.executor).toBe('nx:run-commands')
    expect(test.options).toEqual({
      command: 'vitest run',
      cwd: 'project-a',
    })
    expect(test.outputs).toEqual(['{projectRoot}/coverage'])
    expect(test.cache).toBe(true)
    expect(test.dependsOn).toEqual(['^build'])
  })

  it('test:watch is uncached, test:coverage runs vitest run --coverage', async () => {
    const [, fn] = createNodesV2
    const results = await fn(['project-a/vitest.config.ts'], {}, makeContext())
    const targets = results[0]![1].projects!['project-a']!.targets!

    expect(targets['test:watch']!.cache).toBe(false)
    expect(targets['test:watch']!.options).toEqual({ command: 'vitest', cwd: 'project-a' })
    expect(targets['test:coverage']!.options).toEqual({
      command: 'vitest run --coverage',
      cwd: 'project-a',
    })
  })

  it('skips the workspace root (configFile at ./)', async () => {
    const [, fn] = createNodesV2
    const results = await fn(['vitest.config.ts'], {}, makeContext())
    expect(results).toHaveLength(0)
  })

  it('skips configs inside node_modules', async () => {
    const [, fn] = createNodesV2
    const results = await fn(['node_modules/pkg/vitest.config.ts'], {}, makeContext())
    expect(results).toHaveLength(0)
  })

  it('infers targets for each non-root project', async () => {
    const [, fn] = createNodesV2
    const results = await fn(
      ['project-a/vitest.config.ts', 'project-b/vitest.config.mts', 'vitest.config.ts'],
      {},
      makeContext(),
    )
    expect(results).toHaveLength(2)
    const roots = results.flatMap((r) => Object.keys(r[1].projects!))
    expect(roots).toEqual(expect.arrayContaining(['project-a', 'project-b']))
  })

  describe('verbose logging', () => {
    it('logs when NX_VERBOSE_LOGGING=true', async () => {
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
      process.env.NX_VERBOSE_LOGGING = 'true'

      await createNodesV2[1](['project-a/vitest.config.ts'], {}, makeContext())
      expect(infoSpy).toHaveBeenCalled()

      infoSpy.mockRestore()
    })

    it('does not log without the flag or env var', async () => {
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
      delete process.env.NX_VERBOSE_LOGGING
      process.argv = process.argv.filter((a) => a !== '--verbose')

      await createNodesV2[1](['project-a/vitest.config.ts'], {}, makeContext())
      expect(infoSpy).not.toHaveBeenCalled()

      infoSpy.mockRestore()
    })
  })
})
