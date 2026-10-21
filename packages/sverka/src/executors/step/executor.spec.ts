import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecutorContext } from '@nx/devkit'
import { describe, expect, it } from 'vitest'
import { stepExecutor } from './executor.ts'

const CONFIG = `
import { Project, Pipeline, ShellStep, Entry, push } from '@sverka/workflow'

const proj = new Project('demo')
const ci = new Pipeline(proj, 'ci')

const lint = new ShellStep(ci, 'lint', {
  command: 'echo lint-ok > lint.txt',
  runtime: { shell: 'sh' },
})

const lintSarif = new ShellStep(ci, 'lint-sarif', {
  command: 'printf %s \\'{"version":"1.0","runs":[]}\\'',
  runtime: { shell: 'sh' },
  outputs: { 'eslint.sarif': { type: 'artifact', fromStdout: true } },
})

const policy = new ShellStep(ci, 'policy', {
  command: 'cat eslint.sarif > policy.txt',
  runtime: { shell: 'sh' },
  inputs: [
    { kind: 'step', step: 'lint-sarif', output: 'eslint.sarif', type: 'artifact' },
  ],
})

const version = new ShellStep(ci, 'version', {
  command: 'printf 1.2.3 > "$SVERKA_OUTPUT_DIR/version"',
  runtime: { shell: 'sh' },
  outputs: { version: { type: 'string' } },
})

const showVersion = new ShellStep(ci, 'show-version', {
  command: 'echo "version=\${version.version}" > version.txt',
  runtime: { shell: 'sh' },
  inputs: [{ kind: 'step', step: 'version', output: 'version', type: 'string' }],
})

export const onPush = new Entry(ci, 'on-push', {
  trigger: push(),
  roots: [lint.node.id, policy.node.id, showVersion.node.id],
})

export default proj
`

function makeWorkspace(): { root: string; projectDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'nx-sverka-exec-'))
  const projectDir = join(root, 'packages/app')
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'sverka.config.ts'), CONFIG)
  return { root, projectDir }
}

function makeContext(root: string): ExecutorContext {
  return {
    root,
    cwd: root,
    isVerbose: false,
    projectName: 'app',
    projectsConfigurations: {
      version: 2,
      projects: {
        app: { name: 'app', root: 'packages/app', targets: {} },
      },
    },
    nxJsonConfiguration: {},
  } as unknown as ExecutorContext
}

describe('@nx-devkit/sverka:step executor', () => {
  it('runs a step in the project directory', async () => {
    const { root, projectDir } = makeWorkspace()
    const result = await stepExecutor({ step: 'ci/lint' }, makeContext(root))

    expect(result.success).toBe(true)
    expect(readFileSync(join(projectDir, 'lint.txt'), 'utf8').trim()).toBe('lint-ok')
  })

  it('publishes a stdout artifact to a stable path', async () => {
    const { root, projectDir } = makeWorkspace()
    const result = await stepExecutor({ step: 'ci/lint-sarif' }, makeContext(root))

    expect(result.success).toBe(true)
    const artifact = join(projectDir, '.sverka/artifacts/ci/lint-sarif/eslint.sarif')
    expect(existsSync(artifact)).toBe(true)
    expect(readFileSync(artifact, 'utf8')).toContain('"version"')
  })

  it('materializes the artifact of a producing step for its consumer', async () => {
    const { root, projectDir } = makeWorkspace()
    await stepExecutor({ step: 'ci/lint-sarif' }, makeContext(root))
    const result = await stepExecutor({ step: 'ci/policy' }, makeContext(root))

    expect(result.success).toBe(true)
    expect(readFileSync(join(projectDir, 'policy.txt'), 'utf8')).toContain('"version"')
  })

  it('fails when the producing step did not run', async () => {
    const { root } = makeWorkspace()

    await expect(stepExecutor({ step: 'ci/policy' }, makeContext(root))).rejects.toThrow(
      /does not exist/,
    )
  })

  it('publishes value outputs and interpolates them in a consumer', async () => {
    const { root, projectDir } = makeWorkspace()
    const producer = await stepExecutor({ step: 'ci/version' }, makeContext(root))
    expect(producer.success).toBe(true)
    expect(
      readFileSync(join(projectDir, '.sverka/artifacts/ci/version/values/version'), 'utf8').trim(),
    ).toBe('1.2.3')

    const consumer = await stepExecutor({ step: 'ci/show-version' }, makeContext(root))
    expect(consumer.success).toBe(true)
    expect(readFileSync(join(projectDir, 'version.txt'), 'utf8').trim()).toBe('version=1.2.3')
  })

  it('reports a failing step', async () => {
    const { root } = makeWorkspace()
    const configPath = join(root, 'packages/app/sverka.config.ts')
    writeFileSync(
      configPath,
      CONFIG.replace("command: 'echo lint-ok > lint.txt'", "command: 'exit 3'"),
    )

    const result = await stepExecutor({ step: 'ci/lint' }, makeContext(root))
    expect(result.success).toBe(false)
  })

  it('rejects an unknown step', async () => {
    const { root } = makeWorkspace()

    await expect(stepExecutor({ step: 'ci/nope' }, makeContext(root))).rejects.toThrow(/not found/)
  })
})
