import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { configFingerprint, loadDefinitionGraph } from './graph.ts'

function makeWorkspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-sverka-graph-'))
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(root, rel), content)
  }
  return root
}

const CONFIG = `
import { Project, Pipeline, ShellStep, Entry, push } from '@sverka/workflow'
import { lintCommand } from './helper.ts'

const proj = new Project('demo')
const ci = new Pipeline(proj, 'ci')
new ShellStep(ci, 'lint', { command: lintCommand() })
export const onPush = new Entry(ci, 'on-push', { trigger: push(), roots: ['lint'] })
export default proj
`

const HELPER = `export function lintCommand(): string {
  return 'oxlint .'
}
`

describe('loadDefinitionGraph', () => {
  it('loads a config and synthesizes its graph', async () => {
    const root = makeWorkspace({ 'sverka.config.ts': CONFIG, 'helper.ts': HELPER })
    const graph = await loadDefinitionGraph(join(root, 'sverka.config.ts'))

    expect(graph.project.id).toBe('demo')
    expect(graph.project.pipelines[0]!.steps[0]!.id).toBe('ci/lint')
  })

  it('folds the local imports into the config fingerprint', () => {
    const root = makeWorkspace({ 'sverka.config.ts': CONFIG, 'helper.ts': HELPER })
    const configPath = join(root, 'sverka.config.ts')

    const first = configFingerprint(configPath)

    // The helper changes — the fingerprint has to change with it, or a
    // long-lived process (the Nx daemon) keeps serving the old graph.
    writeFileSync(join(root, 'helper.ts'), HELPER.replace('oxlint .', 'biome check .'))

    expect(configFingerprint(configPath)).not.toBe(first)
  })

  it('changes the fingerprint when the config itself changes', () => {
    const root = makeWorkspace({ 'sverka.config.ts': CONFIG, 'helper.ts': HELPER })
    const configPath = join(root, 'sverka.config.ts')

    const first = configFingerprint(configPath)
    writeFileSync(join(root, 'sverka.config.ts'), `${CONFIG}\n// touched`)

    expect(configFingerprint(configPath)).not.toBe(first)
  })

  it('rejects a config that does not export a project', async () => {
    const root = makeWorkspace({ 'sverka.config.ts': 'export default 42' })

    await expect(loadDefinitionGraph(join(root, 'sverka.config.ts'))).rejects.toThrow(
      /must export a Project/,
    )
  })
})

describe('the config fingerprint', () => {
  it('covers a helper loaded with a dynamic import', () => {
    const root = makeWorkspace({
      'sverka.config.ts': `
import { Project, Pipeline, ShellStep, Entry, push } from '@sverka/workflow'

const { lintCommand } = await import('./helper.ts')

const proj = new Project('demo')
const ci = new Pipeline(proj, 'ci')
new ShellStep(ci, 'lint', { command: lintCommand() })
export const onPush = new Entry(ci, 'on-push', { trigger: push(), roots: ['lint'] })
export default proj
`,
      'helper.ts': HELPER,
    })
    const configPath = join(root, 'sverka.config.ts')

    const first = configFingerprint(configPath)
    writeFileSync(join(root, 'helper.ts'), HELPER.replace('oxlint .', 'biome check .'))

    expect(configFingerprint(configPath)).not.toBe(first)
  })
})
