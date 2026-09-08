import { mkdtempSync, readFileSync, rmSync, symlinkSync, } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const execFileCalls: {
  command: string
  args: string[]
  options: unknown
}[] = []

let execFileResponse: { error: Error | null; stdout: string; stderr: string } = {
  error: null,
  stdout: '',
  stderr: '',
}

vi.mock('node:child_process', () => ({
  execFile: (
    command: string,
    args: string[],
    options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    execFileCalls.push({ args, command, options })
    // Simulate async execution
    setTimeout(() => {
      callback(execFileResponse.error, execFileResponse.stdout, execFileResponse.stderr)
    }, 0)
  },
}))

const { scanExecutor } = await import('./executor.ts')

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'nx-skillspector-'))
}

function makeFindings(overrides: Partial<Record<string, unknown>>[] = []): string {
  const defaultFindings = [
    {
      id: 'SKILL-001',
      severity: 'HIGH',
      category: 'security',
      confidence: 'high',
      explanation: 'Dangerous eval usage detected',
      remediation: 'Remove eval call',
      code_snippet: 'eval(userInput)',
      intent: 'untrusted code execution',
      tags: ['security', 'rce'],
      location: {
        file: 'skills/code-review/act/agent.ts',
        start_line: 42,
      },
    },
  ]
  const merged = defaultFindings.map((f, i) => ({ ...f, ...overrides[i] }))
  return JSON.stringify(merged)
}

describe('scanExecutor', () => {
  let workspace: string

  beforeEach(() => {
    workspace = makeWorkspace()
    execFileCalls.length = 0
    execFileResponse = { error: null, stdout: '', stderr: '' }
  })

  afterEach(() => {
    rmSync(workspace, { force: true, recursive: true })
  })

  it('default invocation spawns skillspector scan <path> --no-llm --format json', async () => {
    execFileResponse.stdout = makeFindings()

    await scanExecutor({
      options: { path: 'skills/code-review/act' },
      workspaceRoot: workspace,
    })

    expect(execFileCalls).toHaveLength(1)
    const call = execFileCalls[0]!
    expect(call.command).toBe('skillspector')
    expect(call.args).toContain('scan')
    expect(call.args).toContain('skills/code-review/act')
    expect(call.args).toContain('--no-llm')
    expect(call.args).toContain('--format')
    expect(call.args).toContain('json')
  })

  it('LLM enabled does NOT pass --no-llm', async () => {
    execFileResponse.stdout = makeFindings()

    await scanExecutor({
      options: { path: 'skills/code-review/act', noLlm: false },
      workspaceRoot: workspace,
    })

    const call = execFileCalls[0]!
    expect(call.args).not.toContain('--no-llm')
  })

  it('baseline is passed through to skillspector', async () => {
    execFileResponse.stdout = makeFindings()

    await scanExecutor({
      options: { path: 'skills/code-review/act', baseline: 'baselines/skills.json' },
      workspaceRoot: workspace,
    })

    const call = execFileCalls[0]!
    expect(call.args).toContain('--baseline')
    expect(call.args).toContain('baselines/skills.json')
  })

  it('writes SARIF report when sarif option is set', async () => {
    execFileResponse.stdout = makeFindings()
    const sarifRelPath = 'reports/scan-test.sarif'
    const sarifAbsPath = join(workspace, sarifRelPath)

    await scanExecutor({
      options: {
        path: 'skills/code-review/act',
        sarif: sarifRelPath,
        annotations: false,
      },
      workspaceRoot: workspace,
    })

    const sarifContent = readFileSync(sarifAbsPath, 'utf8')
    const sarif = JSON.parse(sarifContent) as Record<string, unknown>
    expect(sarif.$schema).toBe(
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/Schemata/sarif-schema-2.1.0.json',
    )
    expect(sarif.version).toBe('2.1.0')
    const runs = sarif.runs as Array<Record<string, unknown>>
    expect(runs).toHaveLength(1)
    const results = runs[0]!.results as Array<Record<string, unknown>>
    expect(results).toHaveLength(1)
    const result = results[0]!
    expect(result.ruleId).toBe('SKILL-001')
    expect(result.level).toBe('error')
    const message = result.message as { text: string }
    expect(message.text).toBe('Dangerous eval usage detected')
    const locations = result.locations as Array<Record<string, unknown>>
    const physLoc = locations[0]!.physicalLocation as {
      artifactLocation: { uri: string }
      region: { startLine: number }
    }
    expect(physLoc.artifactLocation.uri).toBe('skills/code-review/act/agent.ts')
    expect(physLoc.region.startLine).toBe(42)
  })

  it('rejects SARIF path that escapes workspace via sibling prefix', async () => {
    execFileResponse.stdout = makeFindings()
    const escapePath = '../workspace-evil/report.sarif'

    const result = await scanExecutor({
      options: {
        path: 'skills/code-review/act',
        sarif: escapePath,
        annotations: false,
      },
      workspaceRoot: workspace,
    })

    expect(result.success).toBe(false)
  })

  it('rejects SARIF path that escapes via symlink (CWE-59)', async () => {
    execFileResponse.stdout = makeFindings()
    // Create a symlink inside workspace pointing outside
    const outsideDir = mkdtempSync(join(tmpdir(), 'outside-'))
    const linkDir = join(workspace, 'link')
    symlinkSync(outsideDir, linkDir, 'dir')

    const result = await scanExecutor({
      options: {
        path: 'skills/code-review/act',
        sarif: 'link/report.sarif',
        annotations: false,
      },
      workspaceRoot: workspace,
    })

    expect(result.success).toBe(false)
    rmSync(outsideDir, { recursive: true, force: true })
  })

  it('annotates code findings (.ts) but not doc findings (.md)', async () => {
    execFileResponse.stdout = JSON.stringify([
      {
        id: 'SKILL-CODE',
        severity: 'LOW',
        category: 'style',
        confidence: 'medium',
        explanation: 'Missing semicolon',
        remediation: 'Add semicolon',
        code_snippet: 'const x = 1',
        intent: 'style',
        tags: ['style'],
        location: { file: 'skills/code-review/act/agent.ts', start_line: 10 },
      },
      {
        id: 'SKILL-DOC',
        severity: 'LOW',
        category: 'docs',
        confidence: 'low',
        explanation: 'Missing description',
        remediation: 'Add description',
        code_snippet: '',
        intent: 'docs',
        tags: ['docs'],
        location: { file: 'skills/code-review/act/SKILL.md', start_line: 1 },
      },
    ])

    await scanExecutor({
      options: { path: 'skills/code-review/act', annotations: true },
      workspaceRoot: workspace,
    })

    const _annotationsPath = join(workspace, 'annotations-code-review-act.txt')
    // The annotations file name includes the projectName hash; check it exists
    // by scanning the workspace for any annotations-*.txt file
    const { readdirSync } = await import('node:fs')
    const files = readdirSync(workspace)
    const annotationsFile = files.find((f) => f.startsWith('annotations-') && f.endsWith('.txt'))
    expect(annotationsFile).toBeDefined()
    const content = readFileSync(join(workspace, annotationsFile!), 'utf8')
    expect(content).toContain('SKILL-CODE')
    expect(content).toContain('agent.ts')
    expect(content).not.toContain('SKILL-DOC')
    expect(content).not.toContain('SKILL.md')
  })

  it('escapes % and newlines in annotation values', async () => {
    execFileResponse.stdout = JSON.stringify([
      {
        id: 'SKILL-ESCAPE',
        severity: 'LOW',
        category: 'style',
        confidence: 'medium',
        explanation: 'Error rate 100% exceeded\nNewline here',
        remediation: 'Fix it',
        code_snippet: '',
        intent: 'test',
        tags: ['test'],
        location: { file: 'skills/code-review/act/agent.ts', start_line: 5 },
      },
    ])

    await scanExecutor({
      options: { path: 'skills/code-review/act', annotations: true },
      workspaceRoot: workspace,
    })

    const { readdirSync } = await import('node:fs')
    const files = readdirSync(workspace)
    const annotationsFile = files.find((f) => f.startsWith('annotations-') && f.endsWith('.txt'))
    expect(annotationsFile).toBeDefined()
    const content = readFileSync(join(workspace, annotationsFile!), 'utf8')
    // % should be encoded as %25
    expect(content).toContain('100%25')
    // Newlines should be literal \n
    expect(content).toContain('\\n')
    // Should NOT contain raw newline in the message portion
    expect(content).not.toContain('100% exceeded\n')
  })

  it('escapes file path in annotations', async () => {
    execFileResponse.stdout = JSON.stringify([
      {
        id: 'SKILL-PATH',
        severity: 'LOW',
        category: 'style',
        confidence: 'medium',
        explanation: 'Some finding',
        remediation: 'Fix it',
        code_snippet: '',
        intent: 'test',
        tags: ['test'],
        location: { file: 'skills/code-review/act/agent.ts', start_line: 5 },
      },
    ])

    await scanExecutor({
      options: { path: 'skills/code-review/act', annotations: true },
      workspaceRoot: workspace,
    })

    const { readdirSync } = await import('node:fs')
    const files = readdirSync(workspace)
    const annotationsFile = files.find((f) => f.startsWith('annotations-') && f.endsWith('.txt'))
    expect(annotationsFile).toBeDefined()
    const content = readFileSync(join(workspace, annotationsFile!), 'utf8')
    // file= value should be escaped (no raw :: or % unescaped)
    // The path itself has no special chars, but verify the format is correct
    expect(content).toContain('file=skills/code-review/act/agent.ts')
  })

  it('escapes % in file path in annotations', async () => {
    execFileResponse.stdout = JSON.stringify([
      {
        id: 'SKILL-PATH',
        severity: 'LOW',
        category: 'style',
        confidence: 'medium',
        explanation: 'Some finding',
        remediation: 'Fix it',
        code_snippet: '',
        intent: 'test',
        tags: ['test'],
        location: { file: 'skills/100%/agent.ts', start_line: 5 },
      },
    ])

    await scanExecutor({
      options: { path: 'skills/100%', annotations: true },
      workspaceRoot: workspace,
    })

    const { readdirSync } = await import('node:fs')
    const files = readdirSync(workspace)
    const annotationsFile = files.find((f) => f.startsWith('annotations-') && f.endsWith('.txt'))
    expect(annotationsFile).toBeDefined()
    const content = readFileSync(join(workspace, annotationsFile!), 'utf8')
    // % in file path should be encoded as %25
    expect(content).toContain('file=skills/100%25/agent.ts')
    expect(content).not.toContain('file=skills/100%/agent.ts')
  })

  it('handles non-JSON stdout (log lines before JSON)', async () => {
    execFileResponse.stdout =
      `INFO: Starting scan...\nWARNING: Using default config\n${makeFindings()}`

    // Should not crash; should parse the JSON portion
    // With failOnError false and a HIGH finding, success should be true
    const result = await scanExecutor({
      options: { path: 'skills/code-review/act', annotations: false, failOnError: false },
      workspaceRoot: workspace,
    })
    expect(result.success).toBe(true)
  })

  it('handles non-JSON stdout with object wrapper (findings key)', async () => {
    execFileResponse.stdout =
      `LOG: scanning\n${JSON.stringify({ findings: JSON.parse(makeFindings()) })}`

    const result = await scanExecutor({
      options: { path: 'skills/code-review/act', annotations: false, failOnError: true },
      workspaceRoot: workspace,
    })

    // HIGH finding should cause failure
    expect(result.success).toBe(false)
  })

  it('HIGH finding fails with failOnError', async () => {
    execFileResponse.stdout = makeFindings([{ severity: 'HIGH' }])

    const result = await scanExecutor({
      options: { path: 'skills/code-review/act', failOnError: true, annotations: false },
      workspaceRoot: workspace,
    })

    expect(result.success).toBe(false)
  })

  it('CRITICAL finding fails with failOnError', async () => {
    execFileResponse.stdout = makeFindings([{ severity: 'CRITICAL' }])

    const result = await scanExecutor({
      options: { path: 'skills/code-review/act', failOnError: true, annotations: false },
      workspaceRoot: workspace,
    })

    expect(result.success).toBe(false)
  })

  it('LOW finding succeeds with failOnError', async () => {
    execFileResponse.stdout = makeFindings([{ severity: 'LOW' }])

    const result = await scanExecutor({
      options: { path: 'skills/code-review/act', failOnError: true, annotations: false },
      workspaceRoot: workspace,
    })

    expect(result.success).toBe(true)
  })

  it('splits custom skillspectorBin into cmd and args', async () => {
    execFileResponse.stdout = makeFindings()

    await scanExecutor({
      options: { path: 'skills/code-review/act', skillspectorBin: 'npx skillspector' },
      workspaceRoot: workspace,
    })

    const call = execFileCalls[0]!
    expect(call.command).toBe('npx')
    expect(call.args).toContain('skillspector')
    expect(call.args).toContain('scan')
    expect(call.args).toContain('skills/code-review/act')
  })

  it('handles skillspectorBin with extra whitespace', async () => {
    execFileResponse.stdout = makeFindings()

    await scanExecutor({
      options: { path: 'skills/code-review/act', skillspectorBin: '  npx   skillspector  ' },
      workspaceRoot: workspace,
    })

    const call = execFileCalls[0]!
    expect(call.command).toBe('npx')
    expect(call.args).toContain('skillspector')
  })

  it('does not use shell: true when spawning', async () => {
    execFileResponse.stdout = makeFindings()

    await scanExecutor({
      options: { path: 'skills/code-review/act' },
      workspaceRoot: workspace,
    })

    const call = execFileCalls[0]!
    const opts = call.options as { shell?: boolean }
    expect(opts.shell).not.toBe(true)
  })
})
