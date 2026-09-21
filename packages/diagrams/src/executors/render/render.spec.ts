import type { ExecutorContext } from '@nx/devkit'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { vol } from 'memfs'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async () => {
  const memfs = await import('memfs')
  return { ...memfs.fs, default: memfs.fs }
})

vi.mock('fs', async () => {
  const memfs = await import('memfs')
  return { ...memfs.fs, default: memfs.fs }
})

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
  const workspace = '/workspace'

  beforeEach(() => {
    vol.reset()
    state.fetchCalls.length = 0
    state.spawnCalls.length = 0
    state.fetchResponse = { body: '<svg/>', status: 200 }
    state.spawnResponse = { status: 0, stderr: '' }
    state.spawnWritesOutput = true
    mkdirSync(workspace, { recursive: true })
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

  it('rejects an explicit output whose extension conflicts with the format', async () => {
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\n@enduml')

    await expect(
      renderExecutor(
        { file: 'auth.puml', format: 'png', output: 'auth.svg' },
        makeContext(workspace),
      ),
    ).rejects.toThrow(/declares \.svg but format is png/)
    expect(state.fetchCalls).toHaveLength(0)
  })

  it('appends the format extension when an explicit output has none', async () => {
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\n@enduml')

    await renderExecutor({ file: 'auth.puml', output: 'out/auth' }, makeContext(workspace))

    expect(existsSync(join(workspace, 'out/auth.svg'))).toBe(true)
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

  it('removes a stale output before running the command', async () => {
    writeFileSync(join(workspace, 'flow.mmd'), 'graph TD')
    writeFileSync(join(workspace, 'flow.svg'), 'stale')
    state.spawnWritesOutput = false

    await expect(
      renderExecutor(
        { commands: { mermaid: 'mmdc -i {input} -o {output}' }, file: 'flow.mmd' },
        makeContext(workspace),
      ),
    ).rejects.toThrow('did not create')
  })

  it('rejects an output path escaping the workspace', async () => {
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\n@enduml')

    await expect(
      renderExecutor({ file: 'auth.puml', output: '../auth.svg' }, makeContext(workspace)),
    ).rejects.toThrow('inside the workspace')
    // Backslash separators must not bypass the traversal check on win32.
    await expect(
      renderExecutor({ file: 'auth.puml', output: '..\\auth.svg' }, makeContext(workspace)),
    ).rejects.toThrow('inside the workspace')
  })

  it('dryRun works without any configured renderer', async () => {
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\n@enduml')

    const result = await renderExecutor(
      { dryRun: true, file: 'auth.puml', krokiUrl: '' },
      makeContext(workspace),
    )

    expect(result.success).toBe(true)
    expect(state.fetchCalls).toHaveLength(0)
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

  describe('markdown blocks', () => {
    it('POSTs the block body, not the markdown file, to kroki', async () => {
      writeFileSync(
        join(workspace, 'guide.md'),
        '# G\n\n```mermaid\ngraph TD; A-->B\n```\n\n```ts\nx\n```\n',
      )

      await renderExecutor(
        { block: 0, file: 'guide.md', output: 'guide-1.svg' },
        makeContext(workspace),
      )

      expect(state.fetchCalls).toEqual([
        {
          body: 'graph TD; A-->B\n',
          contentType: 'text/plain',
          method: 'POST',
          url: 'https://kroki.io/mermaid/svg',
        },
      ])
      expect(readFileSync(join(workspace, 'guide-1.svg'))).toEqual(Buffer.from('<svg/>'))
    })

    it('selects the block by index in batch mode via blocks[]', async () => {
      writeFileSync(join(workspace, 'a.puml'), '@startuml\n@enduml')
      writeFileSync(
        join(workspace, 'g.md'),
        '```mermaid\ngraph TD; A-->B\n```\n~~~d2\nx -> y\n~~~\n',
      )

      await renderExecutor(
        {
          blocks: [null, 0, 1],
          files: ['a.puml', 'g.md', 'g.md'],
          outputs: ['a.svg', 'g-1.svg', 'g-2.svg'],
        },
        makeContext(workspace),
      )

      expect(state.fetchCalls.map((c) => c.url)).toEqual([
        'https://kroki.io/plantuml/svg',
        'https://kroki.io/mermaid/svg',
        'https://kroki.io/d2/svg',
      ])
      expect(state.fetchCalls[2]?.body).toBe('x -> y\n')
      expect(existsSync(join(workspace, 'g-1.svg'))).toBe(true)
      expect(existsSync(join(workspace, 'g-2.svg'))).toBe(true)
    })

    it('fails when the block index is out of range', async () => {
      writeFileSync(join(workspace, 'guide.md'), '```mermaid\ngraph TD;\n```\n')

      await expect(
        renderExecutor(
          { block: 5, file: 'guide.md', output: 'guide-6.svg' },
          makeContext(workspace),
        ),
      ).rejects.toThrow('block 5 is out of range')
    })

    it('writes the block body to a temp input file for command overrides', async () => {
      writeFileSync(join(workspace, 'guide.md'), '```mermaid\ngraph TD; A-->B\n```\n')

      await renderExecutor(
        {
          block: 0,
          commands: { mermaid: 'mmdc -i {input} -o {output}' },
          file: 'guide.md',
          output: 'guide-1.svg',
        },
        makeContext(workspace),
      )

      expect(state.fetchCalls).toHaveLength(0)
      const cmd = state.spawnCalls[0]?.command ?? ''
      const inputArg = cmd.match(/-i (\S+)/)?.[1]?.replace(/^'|'$/g, '')
      expect(inputArg).toMatch(/nx-diagrams-[^/\\]+[/\\]block\.mmd$/)
      // Temp input is cleaned up after the command runs.
      expect(existsSync(inputArg ?? '')).toBe(false)
      expect(existsSync(join(workspace, 'guide-1.svg'))).toBe(true)
    })

    it('dryRun reports the block index without rendering', async () => {
      writeFileSync(join(workspace, 'guide.md'), '```mermaid\ngraph TD;\n```\n')
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})

      await renderExecutor(
        { block: 0, dryRun: true, file: 'guide.md', output: 'guide-1.svg' },
        makeContext(workspace),
      )

      expect(log).toHaveBeenCalledWith('[dryRun] would render guide.md block 0 -> guide-1.svg')
      expect(state.fetchCalls).toHaveLength(0)
      log.mockRestore()
    })
  })
})
