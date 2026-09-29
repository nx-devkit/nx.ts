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
  const root = mkdtempSync(join(tmpdir(), 'nx-playwright-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

describe('@nx-devkit/playwright createNodesV2', () => {
  it('triggers on playwright.config files', () => {
    expect(createNodesV2[0]).toBe('**/playwright.config.{ts,js,mts,mjs,cjs,cts}')
  })

  it('infers a cached e2e target on the owning project', async () => {
    const root = makeWorkspace({ 'apps/web/playwright.config.ts': 'export default {}' })
    const results = await createNodesV2[1](['apps/web/playwright.config.ts'], {}, makeContext(root))

    const project = results[0]![1].projects!['apps/web']!
    const target = project.targets!.e2e!
    expect(target.executor).toBe('nx:run-commands')
    expect(target.cache).toBe(true)
    expect(target.options).toMatchObject({ command: 'npx playwright test', cwd: '{projectRoot}' })
    expect(target.inputs).toContain('{projectRoot}/playwright.config.ts')
    expect(target.outputs).toContain('{projectRoot}/test-results')
  })

  it('infers uncached e2e:ui and e2e:update-snapshots targets', async () => {
    const root = makeWorkspace({ 'playwright.config.ts': 'export default {}' })
    const results = await createNodesV2[1](['playwright.config.ts'], {}, makeContext(root))
    const targets = results[0]![1].projects!['']!.targets!

    expect(targets['e2e:ui']!.cache).toBe(false)
    expect(targets['e2e:ui']!.options.command).toBe('npx playwright test --ui')
    expect(targets['e2e:update-snapshots']!.options.command).toBe(
      'npx playwright test --update-snapshots',
    )
  })

  it('groups several configs in one directory into a single target set', async () => {
    const root = makeWorkspace({
      'a/playwright.config.ts': 'export default {}',
      'a/playwright.config.js': 'export default {}',
    })
    const results = await createNodesV2[1](
      ['a/playwright.config.ts', 'a/playwright.config.js'],
      {},
      makeContext(root),
    )

    expect(results).toHaveLength(1)
    const targets = results[0]![1].projects!.a!.targets!
    expect(Object.keys(targets).sort()).toEqual(['e2e', 'e2e:ui', 'e2e:update-snapshots'])
    expect(targets.e2e!.inputs).toContain('{projectRoot}/playwright.config.js')
  })

  it('honors targetName and extraTargets options', async () => {
    const root = makeWorkspace({ 'playwright.config.ts': 'export default {}' })
    const results = await createNodesV2[1](
      ['playwright.config.ts'],
      { targetName: 'browser-test', extraTargets: false },
      makeContext(root),
    )
    const targets = results[0]![1].projects!['']!.targets!

    expect(targets['browser-test']).toBeDefined()
    expect(targets.e2e).toBeUndefined()
    expect(targets['browser-test:ui']).toBeUndefined()
  })

  it('skips configs inside node_modules', async () => {
    const root = makeWorkspace({ 'node_modules/x/playwright.config.ts': 'export default {}' })
    const results = await createNodesV2[1](
      ['node_modules/x/playwright.config.ts'],
      {},
      makeContext(root),
    )
    expect(results).toHaveLength(0)
  })

  it('produces deterministic output regardless of input order', async () => {
    const root = makeWorkspace({
      'a/playwright.config.ts': 'export default {}',
      'b/playwright.config.ts': 'export default {}',
    })
    const fwd = await createNodesV2[1](
      ['a/playwright.config.ts', 'b/playwright.config.ts'],
      {},
      makeContext(root),
    )
    const rev = await createNodesV2[1](
      ['b/playwright.config.ts', 'a/playwright.config.ts'],
      {},
      makeContext(root),
    )
    expect(fwd).toEqual(rev)
  })
})
