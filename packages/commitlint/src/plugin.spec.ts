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
  const root = mkdtempSync(join(tmpdir(), 'nx-commitlint-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

describe('@nx-devkit/commitlint createNodesV2', () => {
  it('triggers on commitlint config files and package.json', () => {
    expect(createNodesV2[0]).toContain('commitlint.config.js')
    expect(createNodesV2[0]).toContain('.commitlintrc.json')
    expect(createNodesV2[0]).toContain('package.json')
  })

  it('infers an uncached commitlint target for commitlint.config.js at the root', async () => {
    const root = makeWorkspace({ 'commitlint.config.js': 'export default {}' })
    const results = await createNodesV2[1](['commitlint.config.js'], {}, makeContext(root))
    const project = results[0]![1].projects!['']!
    const target = project.targets!.commitlint!

    expect(target.executor).toBe('nx:run-commands')
    expect(target.cache).toBe(false)
    expect(target.options).toMatchObject({ command: 'npx commitlint --last', cwd: '{projectRoot}' })
    expect(target.inputs).toContain('{workspaceRoot}/commitlint.config.js')
  })

  it('honours a custom targetName and args', async () => {
    const root = makeWorkspace({ 'commitlint.config.js': 'export default {}' })
    const results = await createNodesV2[1](
      ['commitlint.config.js'],
      { targetName: 'commits', args: '--from HEAD~5' },
      makeContext(root),
    )
    const target = results[0]![1].projects!['']!.targets!.commits!
    expect(target.options).toMatchObject({ command: 'npx commitlint --from HEAD~5' })
  })

  it('infers on a nested package.json carrying a "commitlint" key', async () => {
    const root = makeWorkspace({ 'packages/a/package.json': '{"name":"a","commitlint":{}}' })
    const results = await createNodesV2[1](['packages/a/package.json'], {}, makeContext(root))

    const project = results[0]![1].projects!['packages/a']!
    expect(project.targets!.commitlint!.options.command).toBe('npx commitlint --last')
  })

  it('ignores package.json without a "commitlint" key', async () => {
    const root = makeWorkspace({ 'packages/a/package.json': '{"name":"a"}' })
    const results = await createNodesV2[1](['packages/a/package.json'], {}, makeContext(root))
    expect(results).toHaveLength(0)
  })

  it('prefers package.json over commitlint.config.js (cosmiconfig order)', async () => {
    const root = makeWorkspace({
      'commitlint.config.js': 'export default {}',
      'package.json': '{"name":"x","commitlint":{}}',
    })
    const results = await createNodesV2[1](
      ['commitlint.config.js', 'package.json'],
      {},
      makeContext(root),
    )
    expect(results).toHaveLength(1)
    const target = results[0]![1].projects!['']!.targets!.commitlint!
    expect(target.inputs).toContain('{workspaceRoot}/package.json')
    expect(target.inputs).toContain('{workspaceRoot}/commitlint.config.js')
  })

  it('skips directories escaping the workspace and node_modules', async () => {
    const root = makeWorkspace()
    const results = await createNodesV2[1](
      ['node_modules/x/commitlint.config.js', '../outside/commitlint.config.js'],
      {},
      makeContext(root),
    )
    expect(results).toHaveLength(0)
  })
})
