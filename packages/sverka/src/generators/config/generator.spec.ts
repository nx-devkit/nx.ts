import type { Tree } from '@nx/devkit'
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing'
import { describe, expect, it } from 'vitest'
import { configGenerator } from './generator.ts'

describe('@nx-devkit/sverka:config', () => {
  /** The config the generator wrote for the `app` project. */
  function appConfig(tree: Tree): string {
    return tree.read('packages/app/sverka.config.ts', 'utf8') ?? ''
  }

  /** A workspace with a root package and a `packages/app` project. */
  function workspaceWithAppProject(projectJson: string) {
    const tree = createTreeWithEmptyWorkspace()
    tree.write('package.json', JSON.stringify({ name: 'workspace' }))
    tree.write('packages/app/project.json', projectJson)
    return tree
  }

  it('generates a config from the package.json scripts', async () => {
    const tree = createTreeWithEmptyWorkspace()
    tree.write(
      'package.json',
      JSON.stringify({
        name: 'app',
        scripts: { lint: 'oxlint .', test: 'vitest run', build: 'tsdown' },
      }),
    )
    tree.write('bun.lock', '')

    await configGenerator(tree)

    const config = tree.read('sverka.config.ts', 'utf8') ?? ''
    expect(config).toContain('new ShellStep(ci, "lint"')
    expect(config).toContain('"bun run lint"')
    expect(config).toContain('"bun run test"')
    expect(config).toContain('"bun run build"')
    expect(config).toContain('trigger: push()')
    expect(config).toContain('export default proj')
  })

  it('skips checks the project does not have', async () => {
    const tree = createTreeWithEmptyWorkspace()
    tree.write('package.json', JSON.stringify({ name: 'app', scripts: { lint: 'oxlint .' } }))

    await configGenerator(tree)

    const config = tree.read('sverka.config.ts', 'utf8') ?? ''
    expect(config).toContain('"lint"')
    expect(config).not.toContain('"test"')
  })

  it('resolves a project that Nx infers from its package.json', async () => {
    const tree = createTreeWithEmptyWorkspace()
    tree.write('package.json', JSON.stringify({ name: 'workspace' }))
    tree.write(
      'packages/app/package.json',
      JSON.stringify({ name: 'app', scripts: { lint: 'oxlint .' } }),
    )

    await configGenerator(tree, { project: 'app' })

    const config = tree.read('packages/app/sverka.config.ts', 'utf8') ?? ''
    expect(config).toContain('"lint"')
    expect(config).toContain('"npm run lint"')
  })

  it('uses the Nx target of a project that has no matching script', async () => {
    const tree = workspaceWithAppProject(
      JSON.stringify({ name: 'app', root: 'packages/app', targets: { lint: {} } }),
    )

    await configGenerator(tree, { project: 'app' })

    expect(appConfig(tree)).toContain('"nx run app:lint"')
  })

  it('adds the GitHub checks to a repo-health pipeline', async () => {
    const tree = createTreeWithEmptyWorkspace()
    tree.write('package.json', JSON.stringify({ name: 'app', scripts: { lint: 'oxlint .' } }))

    await configGenerator(tree, {
      githubChecks: ['review-debt', 'secret-scanning'],
    })

    const config = tree.read('sverka.config.ts', 'utf8') ?? ''
    expect(config).toContain('new Pipeline(proj, "repo-health"')
    expect(config).toContain('new ShellStep(repoHealth, "review-debt"')
    expect(config).toContain('new ShellStep(repoHealth, "secret-scanning"')
    expect(config).toContain('gh api graphql')
    expect(config).toContain('secret-scanning/alerts')
    expect(config).toContain('trigger: manual()')
  })

  it('honours explicit checks', async () => {
    const tree = createTreeWithEmptyWorkspace()
    tree.write('package.json', JSON.stringify({ name: 'app', scripts: {} }))

    await configGenerator(tree, { checks: ['lint', 'test'] })

    const config = tree.read('sverka.config.ts', 'utf8') ?? ''
    expect(config).toContain('"npm run lint"')
    expect(config).toContain('"npm run test"')
  })

  it('rejects an unknown project', async () => {
    const tree = createTreeWithEmptyWorkspace()
    tree.write('package.json', JSON.stringify({ name: 'workspace' }))

    await expect(configGenerator(tree, { project: 'nope' })).rejects.toThrow(
      /not found in the workspace/,
    )
  })

  it('ignores node_modules when it looks for projects', async () => {
    const tree = createTreeWithEmptyWorkspace()
    tree.write('package.json', JSON.stringify({ name: 'workspace' }))
    tree.write(
      'node_modules/dep/package.json',
      JSON.stringify({ name: 'dep', scripts: { lint: 'oxlint .' } }),
    )

    // The dependency is not a workspace project — the generator reports
    // the unknown name instead of writing a config for it.
    await expect(configGenerator(tree, { project: 'dep' })).rejects.toThrow(
      /not found in the workspace/,
    )
    expect(tree.exists('node_modules/dep/sverka.config.ts')).toBe(false)
  })

  it('emits a valid identifier for a dashed pipeline name', async () => {
    const tree = createTreeWithEmptyWorkspace()
    tree.write('package.json', JSON.stringify({ name: 'app', scripts: { lint: 'oxlint .' } }))

    await configGenerator(tree, { pipeline: 'my-ci' })

    const config = tree.read('sverka.config.ts', 'utf8') ?? ''
    expect(config).toContain('const ci = new Pipeline(proj, "my-ci")')
    expect(config).toContain('new ShellStep(ci, "lint"')
  })

  it('reads a project.json with comments', async () => {
    const tree = workspaceWithAppProject(
      '{ /* the app */ "name": "app", "root": "packages/app", "targets": { "lint": {} } }',
    )

    await configGenerator(tree, { project: 'app' })

    expect(appConfig(tree)).toContain('"nx run app:lint"')
  })

  it('emits a valid identifier for the entry export', async () => {
    const tree = createTreeWithEmptyWorkspace()
    tree.write('package.json', JSON.stringify({ name: 'app', scripts: { lint: 'oxlint .' } }))

    await configGenerator(tree, { entry: 'run-1' })

    const config = tree.read('sverka.config.ts', 'utf8') ?? ''
    expect(config).toContain('export const run1 = new Entry(ci, "run-1"')
  })

  it('does not collide with the identifiers the generated file declares', async () => {
    const tree = createTreeWithEmptyWorkspace()
    tree.write('package.json', JSON.stringify({ name: 'app', scripts: { lint: 'oxlint .' } }))

    await configGenerator(tree, { entry: 'ci' })

    const config = tree.read('sverka.config.ts', 'utf8') ?? ''
    expect(config).toContain('export const ciEntry = new Entry(ci, "ci"')
  })

  it('refuses to overwrite an existing config', async () => {
    const tree = createTreeWithEmptyWorkspace()
    tree.write('package.json', JSON.stringify({ name: 'app', scripts: { lint: 'oxlint .' } }))
    tree.write('sverka.config.ts', 'export default null')

    await expect(configGenerator(tree)).rejects.toThrow(/already exists/)
  })

  it('fails when the project has no checks', async () => {
    const tree = createTreeWithEmptyWorkspace()
    tree.write('package.json', JSON.stringify({ name: 'app', scripts: {} }))

    await expect(configGenerator(tree)).rejects.toThrow(/no checks found/)
  })
})

describe('the entry identifier', () => {
  it('rejects a reserved word', async () => {
    const tree = createTreeWithEmptyWorkspace()
    tree.write('package.json', JSON.stringify({ name: 'app', scripts: { lint: 'oxlint .' } }))

    await configGenerator(tree, { entry: 'default' })

    const config = tree.read('sverka.config.ts', 'utf8') ?? ''
    expect(config).toContain('export const defaultEntry = new Entry(ci, "default"')
  })
})
