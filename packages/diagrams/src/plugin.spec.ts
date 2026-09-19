import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createNodesV2, diagramTypeFor, slugify } from './plugin.ts'

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'nx-diagrams-plugin-'))
}

function mergedTargets(result: unknown): Record<string, Record<string, unknown>> {
  const entries = result as (readonly [
    string,
    { projects: Record<string, { targets?: Record<string, unknown> }> },
  ])[]
  const targets: Record<string, Record<string, unknown>> = {}
  for (const [, { projects }] of entries) {
    for (const [root, project] of Object.entries(projects)) {
      targets[root] = { ...targets[root], ...project.targets }
    }
  }
  return targets
}

const ctx = (workspaceRoot: string) => ({
  nxJsonConfiguration: {},
  workspaceRoot,
})

describe('createNodesV2', () => {
  let workspace: string

  beforeEach(() => {
    workspace = makeWorkspace()
  })
  afterEach(() => {
    rmSync(workspace, { force: true, recursive: true })
  })

  it('watches the diagram extensions glob', () => {
    const glob = createNodesV2[0]
    expect(glob).toContain('.puml')
    expect(glob).toContain('.mmd')
    expect(glob).toContain('.d2')
  })

  it('maps extensions to kroki types', () => {
    expect(diagramTypeFor('a/b.puml')).toBe('plantuml')
    expect(diagramTypeFor('a/b.mermaid')).toBe('mermaid')
    expect(diagramTypeFor('a/b.gv')).toBe('graphviz')
    expect(diagramTypeFor('a/b.txt')).toBeUndefined()
  })

  it('slugifies relative paths', () => {
    expect(slugify('docs/puml/auth.puml')).toBe('docs-puml-auth')
    expect(slugify('auth.puml')).toBe('auth')
  })

  it('infers per-file and aggregate targets on the owning project', () => {
    mkdirSync(join(workspace, 'packages/docs/diagrams'), { recursive: true })
    writeFileSync(join(workspace, 'packages/docs/package.json'), '{"name":"docs"}')
    writeFileSync(join(workspace, 'packages/docs/diagrams/auth.puml'), '@startuml\n@enduml')

    const result = createNodesV2[1](['packages/docs/diagrams/auth.puml'], {}, ctx(workspace))
    const targets = mergedTargets(result)

    expect(Object.keys(targets)).toEqual(['packages/docs'])
    const perFile = targets['packages/docs']?.['diagram-diagrams-auth'] as {
      cache: boolean
      executor: string
      inputs: string[]
      options: { file: string; format: string }
      outputs: string[]
    }
    expect(perFile.cache).toBe(true)
    expect(perFile.executor).toBe('@nx-devkit/diagrams:render')
    expect(perFile.inputs).toEqual(['{workspaceRoot}/packages/docs/diagrams/auth.puml'])
    expect(perFile.outputs).toEqual(['{workspaceRoot}/packages/docs/diagrams/auth.svg'])
    expect(perFile.options.file).toBe('packages/docs/diagrams/auth.puml')
    expect(perFile.options.format).toBe('svg')

    const aggregate = targets['packages/docs']?.diagrams as {
      options: { files: string[] }
    }
    expect(aggregate.options.files).toEqual(['packages/docs/diagrams/auth.puml'])
  })

  it('attaches root-level diagrams to the "." project', () => {
    writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
    writeFileSync(join(workspace, 'flow.mmd'), 'graph TD')

    const result = createNodesV2[1](['flow.mmd'], {}, ctx(workspace))
    const targets = mergedTargets(result)

    expect(Object.keys(targets)).toEqual(['.'])
    expect(targets['.']?.['diagram-flow']).toBeDefined()
  })

  it('disambiguates duplicate basenames via path slug', () => {
    for (const dir of ['a', 'b']) {
      mkdirSync(join(workspace, dir), { recursive: true })
      writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
      writeFileSync(join(workspace, dir, 'auth.puml'), '@startuml\n@enduml')
    }

    const result = createNodesV2[1](['a/auth.puml', 'b/auth.puml'], {}, ctx(workspace))
    const targets = mergedTargets(result)

    expect(targets['.']?.['diagram-a-auth']).toBeDefined()
    expect(targets['.']?.['diagram-b-auth']).toBeDefined()
  })

  it('respects format and outputDir options', () => {
    writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\n@enduml')

    const result = createNodesV2[1](
      ['auth.puml'],
      { format: 'png', outputDir: 'docs/img' },
      ctx(workspace),
    )
    const targets = mergedTargets(result)
    const perFile = targets['.']?.['diagram-auth'] as { outputs: string[] }

    expect(perFile.outputs).toEqual(['{workspaceRoot}/docs/img/auth.png'])
  })

  it('respects a custom aggregate targetName', () => {
    writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\n@enduml')

    const result = createNodesV2[1](
      ['auth.puml'],
      { targetName: 'render-diagrams' },
      ctx(workspace),
    )
    const targets = mergedTargets(result)

    expect(targets['.']?.['render-diagrams']).toBeDefined()
    expect(targets['.']?.diagrams).toBeUndefined()
  })

  it('applies exclude filters', () => {
    writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\n@enduml')

    const result = createNodesV2[1](['auth.puml'], { exclude: ['**/*.puml'] }, ctx(workspace))

    expect(result).toEqual([])
  })

  it('skips files with no type mapping', () => {
    writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')

    const result = createNodesV2[1](['notes.txt'], {}, ctx(workspace))

    expect(result).toEqual([])
  })
})
