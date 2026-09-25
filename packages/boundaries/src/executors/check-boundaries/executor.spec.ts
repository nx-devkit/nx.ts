import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname as pathDirname, join } from 'node:path'
import { logger, type ExecutorContext, type ProjectGraph } from '@nx/devkit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import checkBoundaries from './executor.ts'

interface ProjectFixture {
  name: string
  root: string
  tags: string[]
  files: Record<string, string>
}

let root: string

function scaffold(projects: ProjectFixture[]): ExecutorContext {
  const nodes: ProjectGraph['nodes'] = {}
  for (const p of projects) {
    const dir = join(root, p.root)
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: p.name, nx: { tags: p.tags } }))
    for (const [file, content] of Object.entries(p.files)) {
      const abs = join(dir, file)
      mkdirSync(pathDirname(abs), { recursive: true })
      writeFileSync(abs, content)
    }
    nodes[p.name] = {
      name: p.name,
      type: 'lib',
      data: { root: p.root, name: p.name, tags: p.tags, metadata: { js: { packageName: p.name } } },
    } as ProjectGraph['nodes'][string]
  }
  const graph: ProjectGraph = { nodes, dependencies: {} }
  return {
    root,
    projectGraph: graph,
    nxJsonConfiguration: {},
    cwd: root,
    isVerbose: false,
  } as unknown as ExecutorContext
}

const CONSTRAINTS = [
  { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:feature', 'type:util'] },
  { sourceTag: 'type:feature', onlyDependOnLibsWithTags: ['type:util'] },
]

describe('check-boundaries executor', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nxdevkit-boundaries-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('passes when all imports satisfy the constraints', async () => {
    const ctx = scaffold([
      {
        name: '@acme/app',
        root: 'apps/app',
        tags: ['type:app'],
        files: { 'src/main.ts': "import { u } from '@acme/util'\n" },
      },
      {
        name: '@acme/util',
        root: 'libs/util',
        tags: ['type:util'],
        files: { 'src/index.ts': 'export const u = 1\n' },
      },
    ])
    const res = await checkBoundaries({ depConstraints: CONSTRAINTS }, ctx)
    expect(res.success).toBe(true)
  })

  it('fails with file:line on a forbidden edge', async () => {
    const ctx = scaffold([
      {
        name: '@acme/feature',
        root: 'libs/feature',
        tags: ['type:feature'],
        files: { 'src/index.ts': "import { a } from '@acme/app'\n" },
      },
      {
        name: '@acme/app',
        root: 'apps/app',
        tags: ['type:app'],
        files: { 'src/main.ts': 'export const a = 1\n' },
      },
    ])
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const res = await checkBoundaries({ depConstraints: CONSTRAINTS }, ctx)
    expect(res.success).toBe(false)
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining(
        'libs/feature/src/index.ts:1 — @acme/feature (type:feature) cannot depend on @acme/app (type:app) via "@acme/app"',
      ),
    )
    spy.mockRestore()
  })

  it('resolves relative cross-project imports', async () => {
    const ctx = scaffold([
      {
        name: 'feature',
        root: 'libs/feature',
        tags: ['type:feature'],
        files: { 'src/index.ts': "import { a } from '../../../apps/app/src/main'\n" },
      },
      {
        name: 'app',
        root: 'apps/app',
        tags: ['type:app'],
        files: { 'src/main.ts': 'export const a = 1\n' },
      },
    ])
    const res = await checkBoundaries({ depConstraints: CONSTRAINTS }, ctx)
    expect(res.success).toBe(false)
  })

  it('allows imports when no constraint matches the source tags', async () => {
    const ctx = scaffold([
      {
        name: 'misc',
        root: 'libs/misc',
        tags: ['scope:other'],
        files: { 'src/index.ts': "import { a } from '@acme/app'\n" },
      },
      {
        name: '@acme/app',
        root: 'apps/app',
        tags: ['type:app'],
        files: { 'src/main.ts': 'export const a = 1\n' },
      },
    ])
    const res = await checkBoundaries({ depConstraints: CONSTRAINTS }, ctx)
    expect(res.success).toBe(true)
  })

  it('allows self-imports regardless of constraints', async () => {
    const ctx = scaffold([
      {
        name: '@acme/app',
        root: 'apps/app',
        tags: ['type:app'],
        files: {
          'src/main.ts': "import { b } from './b'\n",
          'src/b.ts': 'export const b = 1\n',
        },
      },
    ])
    const res = await checkBoundaries({ depConstraints: CONSTRAINTS }, ctx)
    expect(res.success).toBe(true)
  })

  it('resolves tsconfig paths mappings', async () => {
    writeFileSync(
      join(root, 'tsconfig.base.json'),
      JSON.stringify({ compilerOptions: { paths: { '@acme/*': ['libs/*/src'] } } }),
    )
    const ctx = scaffold([
      {
        name: 'feature',
        root: 'libs/feature',
        tags: ['type:feature'],
        files: { 'src/index.ts': "import { u } from '@acme/util'\n" },
      },
      {
        name: 'util',
        root: 'libs/util',
        tags: ['type:util'],
        files: { 'src/index.ts': 'export const u = 1\n' },
      },
    ])
    const res = await checkBoundaries({ depConstraints: CONSTRAINTS }, ctx)
    expect(res.success).toBe(true)
  })

  it('ignores external npm imports', async () => {
    const ctx = scaffold([
      {
        name: '@acme/feature',
        root: 'libs/feature',
        tags: ['type:feature'],
        files: { 'src/index.ts': "import lodash from 'lodash'\n" },
      },
    ])
    const res = await checkBoundaries({ depConstraints: CONSTRAINTS }, ctx)
    expect(res.success).toBe(true)
  })
})
