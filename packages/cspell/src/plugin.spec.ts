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
  const root = mkdtempSync(join(tmpdir(), 'nx-cspell-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

describe('@nx-devkit/cspell createNodesV2', () => {
  it('triggers on cspell config files and package.json', () => {
    expect(createNodesV2[0]).toContain('cspell.json')
    expect(createNodesV2[0]).toContain('cspell.config.js')
    expect(createNodesV2[0]).toContain('package.json')
  })

  it('infers a cached spell target for cspell.json at the root', async () => {
    const root = makeWorkspace({ 'cspell.json': '{}' })
    const results = await createNodesV2[1](['cspell.json'], {}, makeContext(root))
    const project = results[0]![1].projects!['']!
    const target = project.targets!.spell!

    expect(target.executor).toBe('nx:run-commands')
    expect(target.cache).toBe(true)
    expect(target.options).toMatchObject({ command: 'npx cspell lint .', cwd: '{projectRoot}' })
    expect(target.inputs).toContain('{workspaceRoot}/cspell.json')
    expect(target.inputs).toContain('{workspaceRoot}/**/*')
  })

  it('honours a custom targetName and args', async () => {
    const root = makeWorkspace({ 'cspell.json': '{}' })
    const results = await createNodesV2[1](
      ['cspell.json'],
      { targetName: 'spellcheck', args: 'src/**/*.md' },
      makeContext(root),
    )
    const target = results[0]![1].projects!['']!.targets!.spellcheck!
    expect(target.options).toMatchObject({ command: 'npx cspell lint src/**/*.md' })
  })

  it('infers on a nested package.json carrying a "cspell" key', async () => {
    const root = makeWorkspace({ 'packages/a/package.json': '{"name":"a","cspell":{}}' })
    const results = await createNodesV2[1](['packages/a/package.json'], {}, makeContext(root))

    const project = results[0]![1].projects!['packages/a']!
    expect(project.targets!.spell!.options.command).toBe('npx cspell lint .')
  })

  it('ignores package.json without a "cspell" key', async () => {
    const root = makeWorkspace({ 'packages/a/package.json': '{"name":"a"}' })
    const results = await createNodesV2[1](['packages/a/package.json'], {}, makeContext(root))
    expect(results).toHaveLength(0)
  })

  it('prefers package.json over cspell.json (search order)', async () => {
    const root = makeWorkspace({
      'cspell.json': '{}',
      'package.json': '{"name":"x","cspell":{}}',
    })
    const results = await createNodesV2[1](['cspell.json', 'package.json'], {}, makeContext(root))
    expect(results).toHaveLength(1)
    const target = results[0]![1].projects!['']!.targets!.spell!
    expect(target.inputs).toContain('{workspaceRoot}/package.json')
    expect(target.inputs).toContain('{workspaceRoot}/cspell.json')
  })

  it('skips directories escaping the workspace and node_modules', async () => {
    const root = makeWorkspace()
    const results = await createNodesV2[1](
      ['node_modules/x/cspell.json', '../outside/cspell.json'],
      {},
      makeContext(root),
    )
    expect(results).toHaveLength(0)
  })
})
