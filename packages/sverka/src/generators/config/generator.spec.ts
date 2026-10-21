import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing'
import { describe, expect, it } from 'vitest'
import { configGenerator } from './generator.ts'

describe('@nx-devkit/sverka:config', () => {
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
    const tree = createTreeWithEmptyWorkspace()
    tree.write('package.json', JSON.stringify({ name: 'workspace', scripts: {} }))
    tree.write(
      'packages/app/project.json',
      JSON.stringify({ name: 'app', root: 'packages/app', targets: { lint: {} } }),
    )

    await configGenerator(tree, { project: 'app' })

    const config = tree.read('packages/app/sverka.config.ts', 'utf8') ?? ''
    expect(config).toContain('"nx run app:lint"')
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
