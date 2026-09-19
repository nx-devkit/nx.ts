import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createNodesV2, DIAGRAM_TYPES, diagramTypeFor, slugify } from './plugin.ts'

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

  it('watches every registered diagram extension', () => {
    const glob = createNodesV2[0]
    for (const ext of Object.keys(DIAGRAM_TYPES)) {
      expect(glob).toContain(ext)
    }
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
      inputs: string[]
      options: { files: string[]; outputs: string[] }
      outputs: string[]
    }
    expect(aggregate.options.files).toEqual(['packages/docs/diagrams/auth.puml'])
    expect(aggregate.options.outputs).toEqual(['packages/docs/diagrams/auth.svg'])
    expect(aggregate.inputs).toEqual(['{workspaceRoot}/packages/docs/diagrams/auth.puml'])
    expect(aggregate.outputs).toEqual(['{workspaceRoot}/packages/docs/diagrams/auth.svg'])
  })

  it('covers all files in the aggregate for multi-diagram projects', () => {
    writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
    writeFileSync(join(workspace, 'a.puml'), '@startuml\n@enduml')
    writeFileSync(join(workspace, 'b.mmd'), 'graph TD')

    const result = createNodesV2[1](['a.puml', 'b.mmd'], {}, ctx(workspace))
    const targets = mergedTargets(result)

    const aggregate = targets['.']?.diagrams as {
      inputs: string[]
      options: { files: string[]; outputs: string[] }
      outputs: string[]
    }
    expect(aggregate.options.files).toEqual(['a.puml', 'b.mmd'])
    expect(aggregate.options.outputs).toEqual(['a.svg', 'b.svg'])
    expect(aggregate.inputs).toEqual(['{workspaceRoot}/a.puml', '{workspaceRoot}/b.mmd'])
    expect(aggregate.outputs).toEqual(['{workspaceRoot}/a.svg', '{workspaceRoot}/b.svg'])
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

  it('expands {projectRoot} in outputDir once, workspace-relative', () => {
    mkdirSync(join(workspace, 'packages/docs/diagrams'), { recursive: true })
    writeFileSync(join(workspace, 'packages/docs/package.json'), '{"name":"docs"}')
    writeFileSync(join(workspace, 'packages/docs/diagrams/auth.puml'), '@startuml\n@enduml')

    const result = createNodesV2[1](
      ['packages/docs/diagrams/auth.puml'],
      { outputDir: '{projectRoot}/img' },
      ctx(workspace),
    )
    const targets = mergedTargets(result)
    const perFile = targets['packages/docs']?.['diagram-diagrams-auth'] as {
      outputs: string[]
    }

    expect(perFile.outputs).toEqual(['{workspaceRoot}/packages/docs/img/auth.svg'])
  })

  it('rejects outputDir escaping the workspace', () => {
    writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\n@enduml')

    expect(() => createNodesV2[1](['auth.puml'], { outputDir: '../out' }, ctx(workspace))).toThrow(
      'inside the workspace',
    )
  })

  it('disambiguates colliding slugs and outputs deterministically', () => {
    mkdirSync(join(workspace, 'a'), { recursive: true })
    writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
    writeFileSync(join(workspace, 'a-b.puml'), '@startuml\n@enduml')
    writeFileSync(join(workspace, 'a/b.puml'), '@startuml\n@enduml')
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\n@enduml')
    writeFileSync(join(workspace, 'auth.mmd'), 'graph TD')

    const result = createNodesV2[1](
      ['a-b.puml', 'a/b.puml', 'auth.puml', 'auth.mmd'],
      {},
      ctx(workspace),
    )
    const targets = mergedTargets(result)
    const names = Object.keys(targets['.'] ?? {})
    const outputs = Object.values(targets['.'] ?? {}).flatMap(
      (t) => (t as { outputs?: string[] }).outputs ?? [],
    )

    // Files a-b.puml and a/b.puml slug to the same 'a-b' — type+hash suffixes keep both.
    expect(names.filter((n) => n.startsWith('diagram-a-b')).length).toBe(2)
    // Files auth.puml and auth.mmd would both write auth.svg — outputs disambiguated by type.
    expect(outputs).toContain('{workspaceRoot}/auth-plantuml.svg')
    expect(outputs).toContain('{workspaceRoot}/auth-mermaid.svg')
    expect(outputs).not.toContain('{workspaceRoot}/auth.svg')
    expect(new Set(names).size).toBe(names.length)
  })

  it('disambiguates shared outputDir collisions across projects', () => {
    for (const pkg of ['docs', 'web']) {
      mkdirSync(join(workspace, `packages/${pkg}`), { recursive: true })
      writeFileSync(join(workspace, `packages/${pkg}/package.json`), `{"name":"${pkg}"}`)
      writeFileSync(join(workspace, `packages/${pkg}/x.puml`), '@startuml\n@enduml')
    }

    const result = createNodesV2[1](
      ['packages/docs/x.puml', 'packages/web/x.puml'],
      { outputDir: 'img' },
      ctx(workspace),
    )
    const perFileOutputs = Object.values(mergedTargets(result))
      .flatMap((targets) => Object.entries(targets).filter(([name]) => name.startsWith('diagram-')))
      .flatMap(([, t]) => (t as { outputs?: string[] }).outputs ?? [])

    // Both files would render to img/x.svg — every emitted output is unique.
    expect(perFileOutputs.length).toBe(2)
    expect(new Set(perFileOutputs).size).toBe(2)
    expect(perFileOutputs).not.toContain('{workspaceRoot}/img/x.svg')
  })

  it('allocates outputs deterministically regardless of file order', () => {
    for (const pkg of ['docs', 'web']) {
      mkdirSync(join(workspace, `packages/${pkg}`), { recursive: true })
      writeFileSync(join(workspace, `packages/${pkg}/package.json`), `{"name":"${pkg}"}`)
      writeFileSync(join(workspace, `packages/${pkg}/x.puml`), '@startuml\n@enduml')
    }
    const files = ['packages/docs/x.puml', 'packages/web/x.puml']

    const forward = createNodesV2[1](files, { outputDir: 'img' }, ctx(workspace))
    const reversed = createNodesV2[1](files.toReversed(), { outputDir: 'img' }, ctx(workspace))

    expect(reversed).toEqual(forward)
  })

  it('rejects a targetName colliding with an inferred per-file target', () => {
    writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\n@enduml')

    expect(() =>
      createNodesV2[1](['auth.puml'], { targetName: 'diagram-auth' }, ctx(workspace)),
    ).toThrow('collides')
  })

  it('supports brace alternation in include globs', () => {
    writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
    writeFileSync(join(workspace, 'auth.puml'), '@startuml\n@enduml')
    writeFileSync(join(workspace, 'flow.d2'), 'x -> y')

    const result = createNodesV2[1](
      ['auth.puml', 'flow.d2'],
      { include: ['**/*.{puml,mmd}'] },
      ctx(workspace),
    )
    const targets = mergedTargets(result)

    expect(targets['.']?.['diagram-auth']).toBeDefined()
    expect(targets['.']?.['diagram-flow']).toBeUndefined()
  })

  it('emits one configuration per project across multiple roots', () => {
    mkdirSync(join(workspace, 'packages/docs/diagrams'), { recursive: true })
    writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
    writeFileSync(join(workspace, 'packages/docs/package.json'), '{"name":"docs"}')
    writeFileSync(join(workspace, 'packages/docs/diagrams/auth.puml'), '@startuml\n@enduml')
    writeFileSync(join(workspace, 'flow.mmd'), 'graph TD')

    const result = createNodesV2[1](
      ['packages/docs/diagrams/auth.puml', 'flow.mmd'],
      {},
      ctx(workspace),
    )
    const targets = mergedTargets(result)

    expect(Object.keys(targets).sort()).toEqual(['.', 'packages/docs'])
    expect(targets['packages/docs']?.['diagram-diagrams-auth']).toBeDefined()
    expect(targets['packages/docs']?.diagrams).toBeDefined()
    expect(targets['.']?.['diagram-flow']).toBeDefined()
    expect(targets['.']?.diagrams).toBeDefined()
  })

  it('matches a trailing globstar in include filters', () => {
    mkdirSync(join(workspace, 'docs/sub'), { recursive: true })
    writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
    writeFileSync(join(workspace, 'docs/sub/b.puml'), '@startuml\n@enduml')
    writeFileSync(join(workspace, 'root.puml'), '@startuml\n@enduml')

    const result = createNodesV2[1](
      ['docs/sub/b.puml', 'root.puml'],
      { include: ['docs/**'] },
      ctx(workspace),
    )
    const targets = mergedTargets(result)

    expect(targets['.']?.['diagram-docs-sub-b']).toBeDefined()
    expect(targets['.']?.['diagram-root']).toBeUndefined()
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
