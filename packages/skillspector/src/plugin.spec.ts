import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createNodesV2 } from './plugin.ts'

let tmp: string

const ctx = {
  workspaceRoot: '',
  nxJsonConfiguration: {},
} as unknown as Parameters<(typeof createNodesV2)[1]>[2]

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'skillspector-plugin-'))
  ;(ctx as { workspaceRoot: string }).workspaceRoot = tmp
})

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function makeSkill(relPath: string, content = '# Skill'): string {
  const dir = join(tmp, relPath)
  mkdirSync(dir, { recursive: true })
  const skillFile = join(dir, 'SKILL.md')
  writeFileSync(skillFile, content)
  // Return relative path
  return `${relPath}/SKILL.md`
}

function expectedProjectName(projectRoot: string): string {
  const slug = projectRoot.replace(/\//g, '-')
  const hash = createHash('sha256').update(projectRoot).digest('hex').slice(0, 12)
  return `${slug}-${hash}`
}

function callWith(file: string, opts?: Record<string, unknown>) {
  const relFile = file.startsWith(tmp) ? file.slice(tmp.length + 1) : file
  return createNodesV2[1]([relFile], opts ?? {}, ctx)
}

describe('@nx-devkit/skillspector createNodesV2', () => {
  it('uses **/SKILL.md as the trigger pattern', () => {
    const [pattern] = createNodesV2
    expect(pattern).toBe('**/SKILL.md')
  })

  it('infers a scan target for skills/code-review/act/SKILL.md with injective name', async () => {
    const relFile = makeSkill('skills/code-review/act')
    const results = await callWith(relFile)

    expect(results).toHaveLength(1)
    const [configFile, project] = results[0]!
    expect(configFile).toBe(relFile)

    const projectRoot = 'skills/code-review/act'
    const expectedName = expectedProjectName(projectRoot)
    const projects = project.projects
    expect(projects).toHaveProperty(expectedName)
  })

  it('skips workspace root SKILL.md', async () => {
    writeFileSync(join(tmp, 'SKILL.md'), '# Root skill')
    const results = await callWith('SKILL.md')
    expect(results).toHaveLength(0)
  })

  it('skips node_modules SKILL.md', async () => {
    const relFile = makeSkill('node_modules/some-pkg')
    const results = await callWith(relFile)
    expect(results).toHaveLength(0)
  })

  it('produces distinct hash suffixes for skills/a-b and skills/a/b (injective naming)', async () => {
    const file1 = makeSkill('skills/a-b')
    const file2 = makeSkill('skills/a/b')
    const _results = await callWith(`${file1},${file2}`)
    // callWith takes a single file, so call twice
    const results1 = await callWith(file1)
    const results2 = await callWith(file2)

    expect(results1).toHaveLength(1)
    expect(results2).toHaveLength(1)
    const name1 = Object.keys(results1[0]![1].projects!)[0]!
    const name2 = Object.keys(results2[0]![1].projects!)[0]!
    const expectedName1 = expectedProjectName('skills/a-b')
    const expectedName2 = expectedProjectName('skills/a/b')
    expect(name1).toBe(expectedName1)
    expect(name2).toBe(expectedName2)
    expect(name1).not.toBe(name2)
  })

  it('supports custom scan target name via options', async () => {
    const relFile = makeSkill('skills/custom-target')
    const results = await callWith(relFile, { scanTargetName: 'security' })
    const projectRoot = 'skills/custom-target'
    const expectedName = expectedProjectName(projectRoot)
    const targets = results[0]![1].projects![expectedName]!.targets!

    expect(targets).toHaveProperty('security')
    expect(targets).not.toHaveProperty('scan')
  })

  it('cache is disabled when annotations enabled (default)', async () => {
    const relFile = makeSkill('skills/cache-ann-on')
    const results = await callWith(relFile)
    const projectRoot = 'skills/cache-ann-on'
    const expectedName = expectedProjectName(projectRoot)
    const scan = results[0]![1].projects![expectedName]!.targets!.scan!

    expect(scan.cache).toBe(false)
  })

  it('cache is enabled when annotations disabled and noLlm true', async () => {
    const relFile = makeSkill('skills/cache-ann-off')
    const results = await callWith(relFile, { annotations: false, noLlm: true })
    const projectRoot = 'skills/cache-ann-off'
    const expectedName = expectedProjectName(projectRoot)
    const scan = results[0]![1].projects![expectedName]!.targets!.scan!

    expect(scan.cache).toBe(true)
  })

  it('forwards all executor options to the scan target', async () => {
    const relFile = makeSkill('skills/all-opts')
    const results = await callWith(relFile, {
      noLlm: false,
      annotations: false,
      failOnError: false,
      skillspectorBin: 'npx skillspector',
      sarif: 'reports/scan.sarif',
      baseline: 'baselines/skills.json',
    })
    const projectRoot = 'skills/all-opts'
    const expectedName = expectedProjectName(projectRoot)
    const scan = results[0]![1].projects![expectedName]!.targets!.scan!

    expect(scan.executor).toBe('@nx-devkit/skillspector:scan')
    expect(scan.options).toMatchObject({
      path: projectRoot,
      noLlm: false,
      annotations: false,
      failOnError: false,
      skillspectorBin: 'npx skillspector',
      sarif: expect.stringContaining(expectedName),
      baseline: 'baselines/skills.json',
    })
  })

  it('does not set sarif option when opts.sarif is not provided', async () => {
    const relFile = makeSkill('skills/no-sarif')
    const results = await callWith(relFile)
    const projectRoot = 'skills/no-sarif'
    const expectedName = expectedProjectName(projectRoot)
    const scan = results[0]![1].projects![expectedName]!.targets!.scan!

    expect(scan.options).not.toHaveProperty('sarif')
  })

  it('includes findings output and SARIF output when annotations disabled', async () => {
    const relFile = makeSkill('skills/outputs-test')
    const results = await callWith(relFile, {
      annotations: false,
      sarif: 'reports/scan.sarif',
    })
    const projectRoot = 'skills/outputs-test'
    const expectedName = expectedProjectName(projectRoot)
    const scan = results[0]![1].projects![expectedName]!.targets!.scan!

    expect(scan.outputs).toBeDefined()
    expect(scan.outputs).toEqual(
      expect.arrayContaining([
        expect.stringContaining(expectedName),
        expect.stringContaining(`findings-${expectedName}.json`),
      ]),
    )
  })

  it('includes baseline in inputs when set', async () => {
    const relFile = makeSkill('skills/baseline-input')
    const results = await callWith(relFile, { baseline: 'baselines/skills.json' })
    const projectRoot = 'skills/baseline-input'
    const expectedName = expectedProjectName(projectRoot)
    const scan = results[0]![1].projects![expectedName]!.targets!.scan!

    expect(scan.inputs).toEqual(
      expect.arrayContaining(['{projectRoot}/**/*', 'baselines/skills.json', '^production']),
    )
  })
})
