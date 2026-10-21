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
  const root = mkdtempSync(join(tmpdir(), 'nx-sverka-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

const CONFIG = `
import { Project, Pipeline, ShellStep, Entry, push } from '@sverka/workflow'

const proj = new Project('demo')
const ci = new Pipeline(proj, 'ci')

const build = new ShellStep(ci, 'build', { command: 'bun run build' })
const lint = new ShellStep(ci, 'lint', {
  command: 'bun run lint',
  dependsOn: [build.node.id],
})
const lintSarif = new ShellStep(ci, 'lint-sarif', {
  command: 'bun run lint:sarif',
  runtime: { shell: 'sh' },
  outputs: { 'eslint.sarif': { type: 'artifact', fromStdout: true } },
})
const policy = new ShellStep(ci, 'policy', {
  command: 'bun sverka policy',
  runtime: { shell: 'sh' },
  inputs: [
    { kind: 'step', step: 'lint-sarif', output: 'eslint.sarif', type: 'artifact' },
  ],
})

export const onPush = new Entry(ci, 'on-push', {
  trigger: push(),
  roots: [lint.node.id, policy.node.id],
})

export default proj
`

describe('@nx-devkit/sverka createNodesV2', () => {
  it('watches the sverka config file names', () => {
    expect(createNodesV2[0]).toContain('sverka.config.ts')
    expect(createNodesV2[0]).toContain('sverka.config.js')
  })

  it('infers one target per sverka step', async () => {
    const root = makeWorkspace({ 'sverka.config.ts': CONFIG })
    const results = await createNodesV2[1](['sverka.config.ts'], {}, makeContext(root))
    const project = results[0]![1].projects!['']!

    expect(Object.keys(project.targets!).sort()).toEqual([
      'ci:build',
      'ci:lint',
      'ci:lint-sarif',
      'ci:policy',
    ])
  })

  it('gives every step its own executor, options and cache entry', async () => {
    const root = makeWorkspace({ 'sverka.config.ts': CONFIG })
    const results = await createNodesV2[1](['sverka.config.ts'], {}, makeContext(root))
    const targets = results[0]![1].projects!['']!.targets!
    const lint = targets['ci:lint']!

    expect(lint.executor).toBe('@nx-devkit/sverka:step')
    expect(lint.cache).toBe(true)
    expect(lint.options).toEqual({ step: 'ci/lint', entry: 'ci/on-push' })
  })

  it('maps sverka step dependencies onto Nx target dependencies', async () => {
    const root = makeWorkspace({ 'sverka.config.ts': CONFIG })
    const results = await createNodesV2[1](['sverka.config.ts'], {}, makeContext(root))
    const targets = results[0]![1].projects!['']!.targets!

    expect(targets['ci:lint']!.dependsOn).toEqual(['ci:build'])
    expect(targets['ci:policy']!.dependsOn).toEqual(['ci:lint-sarif'])
    expect(targets['ci:build']!.dependsOn).toBeUndefined()
  })

  it('declares the step outputs as Nx outputs', async () => {
    const root = makeWorkspace({ 'sverka.config.ts': CONFIG })
    const results = await createNodesV2[1](['sverka.config.ts'], {}, makeContext(root))
    const targets = results[0]![1].projects!['']!.targets!

    expect(targets['ci:lint-sarif']!.outputs).toEqual([
      '{workspaceRoot}/.sverka/artifacts/ci/lint-sarif/eslint.sarif',
    ])
    expect(targets['ci:lint']!.outputs).toEqual([])
  })

  it('declares the consumed producer artifact as an input', async () => {
    const root = makeWorkspace({ 'sverka.config.ts': CONFIG })
    const results = await createNodesV2[1](['sverka.config.ts'], {}, makeContext(root))
    const targets = results[0]![1].projects!['']!.targets!

    expect(targets['ci:policy']!.inputs).toContain(
      '{workspaceRoot}/.sverka/artifacts/ci/lint-sarif/eslint.sarif',
    )
  })

  it('excludes the sverka scratch space and its own outputs from the inputs', async () => {
    const root = makeWorkspace({ 'sverka.config.ts': CONFIG })
    const results = await createNodesV2[1](['sverka.config.ts'], {}, makeContext(root))
    const targets = results[0]![1].projects!['']!.targets!

    expect(targets['ci:lint']!.inputs).toContain('!{workspaceRoot}/.sverka/workspace/**')
    expect(targets['ci:lint-sarif']!.inputs).toContain(
      '!{workspaceRoot}/.sverka/artifacts/ci/lint-sarif/**',
    )
  })

  it('infers the targets on the project owning the config', async () => {
    const root = makeWorkspace({ 'packages/a/sverka.config.ts': CONFIG })
    const results = await createNodesV2[1](['packages/a/sverka.config.ts'], {}, makeContext(root))
    const project = results[0]![1].projects!['packages/a']!

    expect(project.root).toBe('packages/a')
    expect(project.targets!['ci:lint']!.inputs).toContain('{projectRoot}/**/*')
  })

  it('restricts the inference to a single entry', async () => {
    const root = makeWorkspace({ 'sverka.config.ts': CONFIG })
    const results = await createNodesV2[1](
      ['sverka.config.ts'],
      { entry: 'ci/on-push' },
      makeContext(root),
    )
    const targets = results[0]![1].projects!['']!.targets!

    expect(Object.keys(targets)).toHaveLength(4)
  })

  it('honours a custom target name template', async () => {
    const root = makeWorkspace({ 'sverka.config.ts': CONFIG })
    const results = await createNodesV2[1](
      ['sverka.config.ts'],
      { targetName: 'sverka-{step}' },
      makeContext(root),
    )
    const targets = results[0]![1].projects!['']!.targets!

    expect(Object.keys(targets).sort()).toEqual([
      'sverka-build',
      'sverka-lint',
      'sverka-lint-sarif',
      'sverka-policy',
    ])
  })

  it('skips a config that cannot be loaded', async () => {
    const root = makeWorkspace({ 'sverka.config.ts': 'export default 42' })
    const results = await createNodesV2[1](['sverka.config.ts'], {}, makeContext(root))

    expect(results).toEqual([])
  })
})
