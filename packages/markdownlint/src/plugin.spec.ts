import type { CreateNodesContextV2 } from 'nx/src/devkit-exports'
import { describe, expect, it } from 'vitest'
import { createNodesV2 } from './plugin.ts'

function makeContext(): CreateNodesContextV2 {
  return {
    workspaceRoot: '/workspace',
    nxJsonConfiguration: {},
    turboConfig: undefined,
    projectGraph: { nodes: {}, dependencies: {} },
  } as unknown as CreateNodesContextV2
}

async function infer(files: string[], options = {}) {
  const [, fn] = createNodesV2
  return fn(files, options, makeContext())
}

describe('@nx-devkit/markdownlint createNodesV2', () => {
  it('triggers on .markdownlint and .markdownlint-cli2 config files', () => {
    expect(createNodesV2[0]).toBe('**/.markdownlint*.{json,jsonc,yaml,yml,cjs,mjs}')
  })

  it('root config infers a root lint-md target', async () => {
    const results = await infer(['.markdownlint.json'])
    const project = results[0]![1].projects!['']!
    const lint = project.targets!['lint-md']!

    expect(lint.executor).toBe('nx:run-commands')
    expect(lint.cache).toBe(true)
    expect(lint.options!.command).toBe(
      `markdownlint-cli2 '**/*.md' '#**/node_modules/**' --config .markdownlint.json`,
    )
    expect(lint.options!.cwd).toBe('{workspaceRoot}')
    expect(lint.inputs).toEqual(['{workspaceRoot}/**/*.md', '{workspaceRoot}/.markdownlint.json'])
  })

  it('nested config infers a project lint-md target', async () => {
    const results = await infer(['packages/foo/.markdownlint.json'])
    const project = results[0]![1].projects!['packages/foo']!
    const lint = project.targets!['lint-md']!

    expect(lint.options!.command).toBe(
      `markdownlint-cli2 '{projectRoot}/**/*.md' '#**/node_modules/**' --config packages/foo/.markdownlint.json`,
    )
    expect(lint.inputs).toEqual(['{projectRoot}/**/*.md', '{projectRoot}/.markdownlint.json'])
  })

  it('infers lint-md:fix with cache disabled', async () => {
    const results = await infer(['.markdownlint.json'])
    const fix = results[0]![1].projects!['']!.targets!['lint-md:fix']!

    expect(fix.cache).toBe(false)
    expect(fix.options!.command).toBe(
      `markdownlint-cli2 --fix '**/*.md' '#**/node_modules/**' --config .markdownlint.json`,
    )
  })

  it('skips node_modules configs', async () => {
    const results = await infer(['node_modules/pkg/.markdownlint.json'])
    expect(results).toHaveLength(0)
  })

  it('skips configs escaping the workspace', async () => {
    const results = await infer(['../outside/.markdownlint.json'])
    expect(results).toHaveLength(0)
  })

  it('supports custom target names', async () => {
    const results = await infer(['.markdownlint.json'], { targetName: 'lint-docs' })
    const targets = results[0]![1].projects!['']!.targets!
    expect(targets).toHaveProperty('lint-docs')
    expect(targets).not.toHaveProperty('lint-md')
  })

  it('disables the fix target with fixTargetName: false', async () => {
    const results = await infer(['.markdownlint.json'], { fixTargetName: false })
    const targets = results[0]![1].projects!['']!.targets!
    expect(targets).toHaveProperty('lint-md')
    expect(targets).not.toHaveProperty('lint-md:fix')
  })

  it('accepts .markdownlint-cli2.* configs without --config flag', async () => {
    const results = await infer(['docs/.markdownlint-cli2.cjs'])
    const lint = results[0]![1].projects!.docs!.targets!['lint-md']!
    expect(lint.options!.command).toContain("'{projectRoot}/**/*.md'")
    expect(lint.options!.command).not.toContain('--config')
  })

  it('merges cli2 and rules configs in the same directory into one target', async () => {
    const results = await infer(['.markdownlint.json', '.markdownlint-cli2.jsonc'])
    expect(results).toHaveLength(1)
    const lint = results[0]![1].projects!['']!.targets!['lint-md']!
    expect(lint.options!.command).toContain('--config .markdownlint.json')
  })
})
