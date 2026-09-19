import type { ExecutorContext } from '@nx/devkit'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  fetchCalls: [] as {
    body?: string
    contentType: string | undefined
    method: string | undefined
    url: string
  }[],
  fetchResponse: { body: '<svg/>', status: 200 } as
    | { body: string; status: number }
    | ((url: string) => { body: string; status: number }),
  spawnCalls: [] as { command: string; options: { cwd?: string } | undefined }[],
  spawnResponse: { status: 0, stderr: '' } as {
    error?: { code?: string; message: string }
    signal?: string
    status: number | null
    stderr?: string
  },
  spawnWritesOutput: true,
}

vi.mock('node:child_process', () => ({
  spawnSync: (command: string, options?: { cwd?: string }) => {
    state.spawnCalls.push({ command, options })
    if (state.spawnResponse.status === 0 && state.spawnWritesOutput) {
      // The output path is whichever token ends with an image extension,
      // Independent of the flag spelling the command template used.
      const out = (command.match(/'[^']*'|\S+/g) ?? [])
        .map((token) => token.replace(/^'|'$/g, ''))
        .find((token) => /\.(svg|png|jpe?g)$/.test(token))
      if (out) {
        writeFileSync(join(options?.cwd ?? '', out), '<svg/>')
      }
    }
    return state.spawnResponse
  },
}))

const originalFetch = globalThis.fetch
globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  state.fetchCalls.push({
    body: String(init?.body),
    contentType: headers.get('content-type') ?? undefined,
    method: init?.method,
    url: String(input),
  })
  const res =
    typeof state.fetchResponse === 'function'
      ? state.fetchResponse(String(input))
      : state.fetchResponse
  return new Response(res.body, { status: res.status })
}) as typeof fetch

afterAll(() => {
  globalThis.fetch = originalFetch
})

const renderExecutorModule = await import('./executor.ts')
const renderExecutor = renderExecutorModule.default

function makeContext(root: string, projectName = 'root'): ExecutorContext {
  return {
    projectName,
    projectsConfigurations: { projects: { [projectName]: { root: '.' } } },
    root,
  } as unknown as ExecutorContext
}

describe('renderExecutor', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'nx-diagrams-render-'))
    state.fetchCalls.length = 0
    state.spawnCalls.length = 0
    state.fetchResponse = { body: '<svg/>', status: 200 }
    state.spawnResponse = { status: 0, stderr: '' }
    state.spawnWritesOutput = true
    mkdirSync(workspace, { recursive: true })
  })

  afterEach(() => {
    rmSync(workspace, { force: true, recursive: true })
  })

  it('renders via kroki by default: POSTs source to {krokiUrl}/{type}/{format}', async () => {
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\nA -> B\n@enduml')

    const result = await renderExecutor({ file: 'auth.puml' }, makeContext(workspace))

    expect(result.success).toBe(true)
    expect(state.fetchCalls).toEqual([
      {
        body: '@startuml\nA -> B\n@enduml',
        contentType: 'text/plain',
        method: 'POST',
        url: 'https://kroki.io/plantuml/svg',
      },
    ])
    expect(readFileSync(join(workspace, 'auth.svg'))).toEqual(Buffer.from('<svg/>'))
  })

  it('uses the configured format in the URL and output name', async () => {
    writeFileSync(join(workspace, 'flow.mmd'), 'graph TD')

    await renderExecutor({ file: 'flow.mmd', format: 'png' }, makeContext(workspace))

    expect(state.fetchCalls[0]?.url).toBe('https://kroki.io/mermaid/png')
    expect(existsSync(join(workspace, 'flow.png'))).toBe(true)
  })

  it('renders all files in batch mode', async () => {
    writeFileSync(join(workspace, 'a.puml'), '@startuml\n@enduml')
    writeFileSync(join(workspace, 'b.d2'), 'x -> y')

    await renderExecutor({ files: ['a.puml', 'b.d2'] }, makeContext(workspace))

    expect(state.fetchCalls.map((c) => c.url)).toEqual([
      'https://kroki.io/plantuml/svg',
      'https://kroki.io/d2/svg',
    ])
  })

  it('prefers a configured command over kroki', async () => {
    writeFileSync(join(workspace, 'flow.mmd'), 'graph TD')

    await renderExecutor(
      {
        commands: { mermaid: 'mmdc -i {input} -o {output}' },
        file: 'flow.mmd',
      },
      makeContext(workspace),
    )

    expect(state.fetchCalls).toHaveLength(0)
    expect(state.spawnCalls[0]?.command).toBe('mmdc -i flow.mmd -o flow.svg')
    expect(state.spawnCalls[0]?.options?.cwd).toBe(workspace)
  })

  it('shell-quotes placeholders so paths with spaces stay single arguments', async () => {
    mkdirSync(join(workspace, 'my dir'), { recursive: true })
    writeFileSync(join(workspace, 'my dir/flow.mmd'), 'graph TD')

    await renderExecutor(
      { commands: { mermaid: 'mmdc -i {input} -o {output}' }, file: 'my dir/flow.mmd' },
      makeContext(workspace),
    )

    expect(state.spawnCalls[0]?.command).toBe("mmdc -i 'my dir/flow.mmd' -o 'my dir/flow.svg'")
  })

  it('uses the output path passed via options (collision-suffixed)', async () => {
    writeFileSync(join(workspace, 'auth.mmd'), 'graph TD')

    await renderExecutor({ file: 'auth.mmd', output: 'auth-mermaid.svg' }, makeContext(workspace))

    expect(existsSync(join(workspace, 'auth-mermaid.svg'))).toBe(true)
    expect(existsSync(join(workspace, 'auth.svg'))).toBe(false)
  })

  it('rejects a non-positive timeout', async () => {
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\n@enduml')

    await expect(
      renderExecutor({ file: 'auth.puml', timeout: 0 }, makeContext(workspace)),
    ).rejects.toThrow('positive')
  })

  it('reports command timeouts distinctly', async () => {
    writeFileSync(join(workspace, 'flow.mmd'), 'graph TD')
    state.spawnResponse = {
      error: { code: 'ETIMEDOUT', message: 'timed out' },
      status: null,
    }

    await expect(
      renderExecutor(
        { commands: { mermaid: 'mmdc -i {input} -o {output}' }, file: 'flow.mmd' },
        makeContext(workspace),
      ),
    ).rejects.toThrow('timed out after')
  })

  it('fails when the command exits non-zero, including stderr', async () => {
    writeFileSync(join(workspace, 'flow.mmd'), 'graph TD')
    state.spawnResponse = { status: 1, stderr: 'syntax error on line 1' }

    await expect(
      renderExecutor(
        { commands: { mermaid: 'mmdc -i {input} -o {output}' }, file: 'flow.mmd' },
        makeContext(workspace),
      ),
    ).rejects.toThrow('syntax error on line 1')
  })

  it('fails when the command succeeds but produces no output', async () => {
    writeFileSync(join(workspace, 'flow.mmd'), 'graph TD')
    state.spawnResponse = { status: 0 }
    state.spawnWritesOutput = false

    await expect(
      renderExecutor(
        { commands: { mermaid: 'mmdc -i {input} -o {output}' }, file: 'flow.mmd' },
        makeContext(workspace),
      ),
    ).rejects.toThrow('did not create')
  })

  it('fails on kroki non-2xx with the response body', async () => {
    state.fetchResponse = { body: 'Error 400: syntax error', status: 400 }
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\n@enduml')

    await expect(renderExecutor({ file: 'auth.puml' }, makeContext(workspace))).rejects.toThrow(
      'HTTP 400',
    )
    expect(existsSync(join(workspace, 'auth.svg'))).toBe(false)
  })

  it('fails fast when krokiUrl is empty and no commands are configured', async () => {
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\n@enduml')

    await expect(
      renderExecutor({ file: 'auth.puml', krokiUrl: '' }, makeContext(workspace)),
    ).rejects.toThrow('set krokiUrl or provide commands')
  })

  it('fails per-file when krokiUrl is empty and commands lack the type', async () => {
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\n@enduml')

    await expect(
      renderExecutor(
        { commands: { mermaid: 'mmdc' }, file: 'auth.puml', krokiUrl: '' },
        makeContext(workspace),
      ),
    ).rejects.toThrow('configure commands.plantuml or set krokiUrl')
  })

  it('rejects a non-absolute krokiUrl', async () => {
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\n@enduml')

    await expect(
      renderExecutor({ file: 'auth.puml', krokiUrl: 'kroki.local' }, makeContext(workspace)),
    ).rejects.toThrow('absolute http(s) URL')
  })

  it('dryRun reports outputs without rendering or writing', async () => {
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\n@enduml')

    const result = await renderExecutor({ dryRun: true, file: 'auth.puml' }, makeContext(workspace))

    expect(result.success).toBe(true)
    expect(state.fetchCalls).toHaveLength(0)
    expect(state.spawnCalls).toHaveLength(0)
    expect(existsSync(join(workspace, 'auth.svg'))).toBe(false)
  })

  it('throws when neither file nor files is given', async () => {
    await expect(renderExecutor({}, makeContext(workspace))).rejects.toThrow('file')
  })
})
