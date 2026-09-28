import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CreateNodesContextV2 } from 'nx/src/devkit-exports'
import { describe, expect, it } from 'vitest'
import { createNodesV2, __testing } from './plugin.ts'

function makeContext(workspaceRoot: string): CreateNodesContextV2 {
  return {
    workspaceRoot,
    nxJsonConfiguration: {},
    turboConfig: undefined,
    projectGraph: { nodes: {}, dependencies: {} },
  } as unknown as CreateNodesContextV2
}

function makeWorkspace(changes: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-openspec-'))
  mkdirSync(join(root, 'openspec'), { recursive: true })
  writeFileSync(join(root, 'openspec', 'config.yaml'), 'schema: spec-driven\n')
  for (const id of changes) {
    mkdirSync(join(root, 'openspec', 'changes', id), { recursive: true })
    writeFileSync(join(root, 'openspec', 'changes', id, 'proposal.md'), '# x\n')
  }
  return root
}

describe('@nx-devkit/openspec createNodesV2', () => {
  it('triggers on openspec/config.yaml', () => {
    expect(createNodesV2[0]).toBe('**/openspec/config.yaml')
  })

  it('infers a cached spec-validate target on the owning project', async () => {
    const root = makeWorkspace()
    const [, fn] = createNodesV2
    const results = await fn(['openspec/config.yaml'], {}, makeContext(root))
    const project = results[0]![1].projects!['']!
    const target = project.targets!['spec-validate']!

    expect(target.executor).toBe('nx:run-commands')
    expect(target.cache).toBe(true)
    expect(target.options!.command).toBe('openspec validate --all --strict')
    expect(target.options!.cwd).toBe('{projectRoot}')
    expect(target.inputs).toEqual(['{workspaceRoot}/openspec/**'])
  })

  it('infers one spec-validate:<id> per active change dir', async () => {
    const root = makeWorkspace(['alpha-change', 'beta-fix'])
    const [, fn] = createNodesV2
    const results = await fn(['openspec/config.yaml'], {}, makeContext(root))
    const targets = results[0]![1].projects!['']!.targets!

    expect(targets['spec-validate:alpha-change']!.options!.command).toBe(
      "openspec validate 'alpha-change' --strict",
    )
    expect(targets['spec-validate:alpha-change']!.inputs).toEqual([
      '{workspaceRoot}/openspec/changes/alpha-change/**',
    ])
    expect(targets['spec-validate:beta-fix']).toBeDefined()
  })

  it('skips change dirs without proposal.md and the archive dir', async () => {
    const root = makeWorkspace(['real-change'])
    mkdirSync(join(root, 'openspec', 'changes', 'archive'), { recursive: true })
    mkdirSync(join(root, 'openspec', 'changes', 'empty-dir'), { recursive: true })
    const [, fn] = createNodesV2
    const results = await fn(['openspec/config.yaml'], {}, makeContext(root))
    const targets = results[0]![1].projects!['']!.targets!

    expect(targets['spec-validate:real-change']).toBeDefined()
    expect(targets['spec-validate:archive']).toBeUndefined()
    expect(targets['spec-validate:empty-dir']).toBeUndefined()
  })

  it('nested openspec dir infers a project-level target', async () => {
    const root = makeWorkspace()
    const [, fn] = createNodesV2
    const results = await fn(['packages/foo/openspec/config.yaml'], {}, makeContext(root))
    const target = results[0]![1].projects!['packages/foo']!.targets!['spec-validate']!
    expect(target.inputs).toEqual(['{projectRoot}/openspec/**'])
  })

  it('skips node_modules and out-of-workspace configs', async () => {
    const root = makeWorkspace()
    const [, fn] = createNodesV2
    const bad = await fn(
      ['node_modules/pkg/openspec/config.yaml', '../outside/openspec/config.yaml'],
      {},
      makeContext(root),
    )
    expect(bad).toHaveLength(0)
  })

  it('perChange: false disables atomized targets', async () => {
    const root = makeWorkspace(['alpha-change'])
    const [, fn] = createNodesV2
    const results = await fn(['openspec/config.yaml'], { perChange: false }, makeContext(root))
    const targets = results[0]![1].projects!['']!.targets!
    expect(targets['spec-validate']).toBeDefined()
    expect(targets['spec-validate:alpha-change']).toBeUndefined()
  })

  it('strict: false drops --strict', async () => {
    const root = makeWorkspace()
    const [, fn] = createNodesV2
    const results = await fn(['openspec/config.yaml'], { strict: false }, makeContext(root))
    expect(results[0]![1].projects!['']!.targets!['spec-validate']!.options!.command).toBe(
      'openspec validate --all',
    )
  })

  it('escapes single quotes in change ids', () => {
    const root = makeWorkspace(["it's-weird"])
    const ids = __testing.listChangeIds(join(root, 'openspec'))
    expect(ids).toEqual(["it's-weird"])
  })
})
