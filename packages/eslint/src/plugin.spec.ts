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
  const root = mkdtempSync(join(tmpdir(), 'nx-eslint-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

describe('@nx-devkit/eslint createNodesV2', () => {
  it('triggers on eslint.config files', () => {
    expect(createNodesV2[0]).toBe('**/eslint.config.{js,mjs,cjs,ts,mts,cts}')
  })

  it('infers a cached lint target on the owning project', async () => {
    const root = makeWorkspace({ 'eslint.config.mjs': 'export default []' })
    const results = await createNodesV2[1](['eslint.config.mjs'], {}, makeContext(root))

    const project = results[0]![1].projects!['']!
    const target = project.targets!.lint!
    expect(target.executor).toBe('nx:run-commands')
    expect(target.cache).toBe(true)
    expect(target.options).toMatchObject({ command: 'npx eslint .', cwd: '{projectRoot}' })
    expect(target.inputs).toContain('{workspaceRoot}/eslint.config.mjs')
  })

  it('infers an uncached lint:fix target', async () => {
    const root = makeWorkspace({ 'eslint.config.mjs': 'export default []' })
    const results = await createNodesV2[1](['eslint.config.mjs'], {}, makeContext(root))
    const fix = results[0]![1].projects!['']!.targets!['lint:fix']!

    expect(fix.cache).toBe(false)
    expect(fix.options).toMatchObject({ command: 'npx eslint . --fix' })
  })

  it('infers on a nested config', async () => {
    const root = makeWorkspace({ 'packages/a/eslint.config.mjs': 'export default []' })
    const results = await createNodesV2[1](['packages/a/eslint.config.mjs'], {}, makeContext(root))

    const project = results[0]![1].projects!['packages/a']!
    expect(project.targets!.lint!.options.command).toBe('npx eslint .')
  })

  it('groups several configs in one directory into a single target pair', async () => {
    const root = makeWorkspace({
      'a/eslint.config.mjs': 'export default []',
      'a/eslint.config.cjs': 'module.exports = []',
    })
    const results = await createNodesV2[1](
      ['a/eslint.config.mjs', 'a/eslint.config.cjs'],
      {},
      makeContext(root),
    )

    expect(results).toHaveLength(1)
    const targets = results[0]![1].projects!.a!.targets!
    expect(Object.keys(targets).sort()).toEqual(['lint', 'lint:fix'])
    expect(targets.lint!.inputs).toContain('{projectRoot}/eslint.config.mjs')
    expect(targets.lint!.inputs).toContain('{projectRoot}/eslint.config.cjs')
  })

  it('honors targetName and fixTarget options', async () => {
    const root = makeWorkspace({ 'eslint.config.mjs': 'export default []' })
    const results = await createNodesV2[1](
      ['eslint.config.mjs'],
      { targetName: 'eslint', fixTarget: false },
      makeContext(root),
    )
    const targets = results[0]![1].projects!['']!.targets!

    expect(targets.eslint).toBeDefined()
    expect(targets['eslint:fix']).toBeUndefined()
    expect(targets.lint).toBeUndefined()
  })

  it('skips configs inside node_modules', async () => {
    const root = makeWorkspace({ 'node_modules/x/eslint.config.mjs': 'export default []' })
    const results = await createNodesV2[1](
      ['node_modules/x/eslint.config.mjs'],
      {},
      makeContext(root),
    )
    expect(results).toHaveLength(0)
  })

  it('produces deterministic output regardless of input order', async () => {
    const root = makeWorkspace({
      'a/eslint.config.mjs': 'export default []',
      'b/eslint.config.mjs': 'export default []',
    })
    const fwd = await createNodesV2[1](
      ['a/eslint.config.mjs', 'b/eslint.config.mjs'],
      {},
      makeContext(root),
    )
    const rev = await createNodesV2[1](
      ['b/eslint.config.mjs', 'a/eslint.config.mjs'],
      {},
      makeContext(root),
    )
    expect(fwd).toEqual(rev)
  })
})
