import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CreateNodesContextV2 } from 'nx/src/devkit-exports'
import { describe, expect, it } from 'vitest'
import { createNodesV2 } from './plugin.ts'

function makeContext(workspaceRoot: string): CreateNodesContextV2 {
  return {
    workspaceRoot,
    nxJsonConfiguration: {},
    turboConfig: undefined,
    projectGraph: { nodes: {}, dependencies: {} },
  } as unknown as CreateNodesContextV2
}

function makeWorkspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-knip-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

describe('@nx-devkit/knip createNodesV2', () => {
  it('triggers on knip config files and package.json', () => {
    expect(createNodesV2[0]).toContain('knip.json')
    expect(createNodesV2[0]).toContain('package.json')
  })

  it('infers a cached knip target for a knip.json at the root', async () => {
    const root = makeWorkspace({ 'knip.json': '{}' })
    const results = await createNodesV2[1](['knip.json'], {}, makeContext(root))
    const project = results[0]![1].projects!['']!
    const target = project.targets!.knip!

    expect(target.executor).toBe('nx:run-commands')
    expect(target.cache).toBe(true)
    expect(target.options).toMatchObject({ command: 'npx knip', cwd: '{projectRoot}' })
    expect(target.inputs).toContain('{workspaceRoot}/knip.json')
  })

  it('infers an uncached knip:fix target', async () => {
    const root = makeWorkspace({ 'knip.json': '{}' })
    const results = await createNodesV2[1](['knip.json'], {}, makeContext(root))
    const fix = results[0]![1].projects!['']!.targets!['knip:fix']!

    expect(fix.cache).toBe(false)
    expect(fix.options).toMatchObject({ command: 'npx knip --fix' })
  })

  it('infers on a nested package.json carrying a "knip" key', async () => {
    const root = makeWorkspace({ 'packages/a/package.json': '{"name":"a","knip":{}}' })
    const results = await createNodesV2[1](['packages/a/package.json'], {}, makeContext(root))

    const project = results[0]![1].projects!['packages/a']!
    expect(project.targets!.knip!.options.command).toBe('npx knip')
  })

  it('skips package.json without a "knip" key', async () => {
    const root = makeWorkspace({ 'packages/a/package.json': '{"name":"a"}' })
    const results = await createNodesV2[1](['packages/a/package.json'], {}, makeContext(root))
    expect(results).toHaveLength(0)
  })

  it('groups several config files in one directory into a single target pair', async () => {
    const root = makeWorkspace({ 'knip.json': '{}', 'knip.ts': 'export default {}' })
    const results = await createNodesV2[1](['knip.json', 'knip.ts'], {}, makeContext(root))

    expect(results).toHaveLength(1)
    const targets = results[0]![1].projects!['']!.targets!
    expect(Object.keys(targets).sort()).toEqual(['knip', 'knip:fix'])
    expect(targets.knip!.inputs).toContain('{workspaceRoot}/knip.ts')
  })

  it('honors targetName and fixTarget options', async () => {
    const root = makeWorkspace({ 'knip.json': '{}' })
    const results = await createNodesV2[1](
      ['knip.json'],
      { targetName: 'dead-code', fixTarget: false },
      makeContext(root),
    )
    const targets = results[0]![1].projects!['']!.targets!

    expect(targets['dead-code']).toBeDefined()
    expect(targets['dead-code:fix']).toBeUndefined()
    expect(targets.knip).toBeUndefined()
  })

  it('skips configs inside node_modules', async () => {
    const root = makeWorkspace({ 'node_modules/x/knip.json': '{}' })
    const results = await createNodesV2[1](['node_modules/x/knip.json'], {}, makeContext(root))
    expect(results).toHaveLength(0)
  })

  it('produces deterministic output regardless of input order', async () => {
    const root = makeWorkspace({ 'a/knip.json': '{}', 'b/knip.json': '{}' })
    const fwd = await createNodesV2[1](['a/knip.json', 'b/knip.json'], {}, makeContext(root))
    const rev = await createNodesV2[1](['b/knip.json', 'a/knip.json'], {}, makeContext(root))
    expect(fwd).toEqual(rev)
  })
})
