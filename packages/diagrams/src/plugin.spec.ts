import { mkdirSync, writeFileSync } from 'node:fs'
import { join, matchesGlob } from 'node:path'
import { vol } from 'memfs'
import { Minimatch } from 'minimatch'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNodesV2, DIAGRAM_TYPES, diagramTypeFor, slugify } from './plugin.ts'

vi.mock('node:fs', async () => {
  const memfs = await import('memfs')
  return { ...memfs.fs, default: memfs.fs }
})

vi.mock('fs', async () => {
  const memfs = await import('memfs')
  return { ...memfs.fs, default: memfs.fs }
})

function mergedTargets(result: unknown): Record<string, Record<string, unknown>> {
  const entries = result as (readonly [
    string,
    { projects: Record<string, { targets?: Record<string, unknown> }> },
  ])[],
   targets: Record<string, Record<string, unknown>> = {}
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
  const workspace = '/workspace'

  beforeEach(() => {
    vol.reset()
    mkdirSync(workspace, { recursive: true })
  })

  it('watches every registered diagram extension', () => {
    const glob = createNodesV2[0],
    // Nx filters configFiles with minimatch ({ dot: true }) before invoking
    // createNodes — assert against that engine, not only node:path.
     nxMatcher = new Minimatch(glob, { dot: true })
    for (const ext of Object.keys(DIAGRAM_TYPES)) {
      expect(matchesGlob(`a${ext}`, glob)).toBe(true)
      expect(nxMatcher.match(`a${ext}`)).toBe(true)
      // The trigger glob must match case-insensitively (.PUML on
      // Case-sensitive filesystems) — the type lookup lowercases already.
      expect(matchesGlob(`a${ext.toUpperCase()}`, glob)).toBe(true)
      expect(nxMatcher.match(`a${ext.toUpperCase()}`)).toBe(true)
      const mixed = ext.slice(1).replace(/[a-z]/gi, (c, i) => (i % 2 ? c.toUpperCase() : c))
      expect(matchesGlob(`a.${mixed}`, glob)).toBe(true)
      expect(nxMatcher.match(`a.${mixed}`)).toBe(true)
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

    const result = createNodesV2[1](['packages/docs/diagrams/auth.puml'], {}, ctx(workspace)),
     targets = mergedTargets(result)

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

    const result = createNodesV2[1](['a.puml', 'b.mmd'], {}, ctx(workspace)),
     targets = mergedTargets(result),

     aggregate = targets['.']?.diagrams as {
      inputs: string[]
      options: { files: string[]; outputs: string[] }
      outputs: string[]
    }
    expect(aggregate.options.files).toEqual(['a.puml', 'b.mmd'])
    expect(aggregate.options.outputs).toEqual(['a.svg', 'b.svg'])
    expect(aggregate.inputs).toEqual(['{workspaceRoot}/a.puml', '{workspaceRoot}/b.mmd'])
    expect(aggregate.outputs).toEqual(['{workspaceRoot}/a.svg', '{workspaceRoot}/b.svg'])
  })

  it('forwards krokiImage to inferred targets, defaulting to yuzutech/kroki:latest', () => {
    writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
    writeFileSync(join(workspace, 'a.puml'), '@startuml\n@enduml')

    const defaults = mergedTargets(createNodesV2[1](['a.puml'], {}, ctx(workspace))),
     custom = mergedTargets(
      createNodesV2[1](['a.puml'], { krokiImage: 'mirror.local/kroki:2024.1' }, ctx(workspace)),
    )
    for (const [targets, image] of [
      [defaults, 'yuzutech/kroki:latest'],
      [custom, 'mirror.local/kroki:2024.1'],
    ] as const) {
      const perFile = targets['.']?.['diagram-a'] as { options: { krokiImage?: string } },
       aggregate = targets['.']?.diagrams as { options: { krokiImage?: string } }
      expect(perFile.options.krokiImage).toBe(image)
      expect(aggregate.options.krokiImage).toBe(image)
    }
  })

  it('attaches root-level diagrams to the "." project', () => {
    writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
    writeFileSync(join(workspace, 'flow.mmd'), 'graph TD')

    const result = createNodesV2[1](['flow.mmd'], {}, ctx(workspace)),
     targets = mergedTargets(result)

    expect(Object.keys(targets)).toEqual(['.'])
    expect(targets['.']?.['diagram-flow']).toBeDefined()
  })

  it('disambiguates duplicate basenames via path slug', () => {
    for (const dir of ['a', 'b']) {
      mkdirSync(join(workspace, dir), { recursive: true })
      writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
      writeFileSync(join(workspace, dir, 'auth.puml'), '@startuml\n@enduml')
    }

    const result = createNodesV2[1](['a/auth.puml', 'b/auth.puml'], {}, ctx(workspace)),
     targets = mergedTargets(result)

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
    ),
     targets = mergedTargets(result),
     perFile = targets['.']?.['diagram-auth'] as { outputs: string[] }

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
    ),
     targets = mergedTargets(result),
     perFile = targets['packages/docs']?.['diagram-diagrams-auth'] as {
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
    expect(() =>
      createNodesV2[1](['auth.puml'], { outputDir: '/tmp/out' }, ctx(workspace)),
    ).toThrow('inside the workspace')
    expect(() =>
      createNodesV2[1](['auth.puml'], { outputDir: '{fileDir}/../out' }, ctx(workspace)),
    ).toThrow('inside the workspace')
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
    ),
     targets = mergedTargets(result),
     names = Object.keys(targets['.'] ?? {}),
     outputs = Object.values(targets['.'] ?? {}).flatMap(
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
    ),
     perFileOutputs = Object.values(mergedTargets(result))
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
    const files = ['packages/docs/x.puml', 'packages/web/x.puml'],

     forward = createNodesV2[1](files, { outputDir: 'img' }, ctx(workspace)),
     reversed = createNodesV2[1](files.toReversed(), { outputDir: 'img' }, ctx(workspace))

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
    ),
     targets = mergedTargets(result)

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
    ),
     targets = mergedTargets(result)

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
    ),
     targets = mergedTargets(result)

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
    ),
     targets = mergedTargets(result)

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

  describe('markdown fenced blocks', () => {
    it('matches .md in the trigger glob case-insensitively', () => {
      const glob = createNodesV2[0],
       nxMatcher = new Minimatch(glob, { dot: true })
      for (const f of ['a.md', 'a.MD', 'docs/guide.mD']) {
        expect(matchesGlob(f, glob)).toBe(true)
        expect(nxMatcher.match(f)).toBe(true)
      }
    })

    it('infers one target per diagram block with numbered outputs', () => {
      writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
      mkdirSync(join(workspace, 'docs'), { recursive: true })
      writeFileSync(
        join(workspace, 'docs/guide.md'),
        '# G\n\n```mermaid\ngraph TD; A-->B\n```\n\ntext\n\n```d2\nx -> y\n```\n',
      )

      const result = createNodesV2[1](['docs/guide.md'], {}, ctx(workspace)),
       targets = mergedTargets(result),

       first = targets['.']?.['diagram-docs-guide-1'] as {
        inputs: string[]
        options: { block: number; file: string; output: string }
        outputs: string[]
      }
      expect(first.inputs).toEqual(['{workspaceRoot}/docs/guide.md'])
      expect(first.outputs).toEqual(['{workspaceRoot}/docs/guide-1.svg'])
      expect(first.options).toMatchObject({ block: 0, file: 'docs/guide.md' })

      const second = targets['.']?.['diagram-docs-guide-2'] as {
        options: { block: number; output: string }
      }
      expect(second.options.block).toBe(1)
      expect(second.options.output).toBe('docs/guide-2.svg')

      const aggregate = targets['.']?.diagrams as {
        inputs: string[]
        options: { blocks: (number | null)[]; files: string[]; outputs: string[] }
      }
      expect(aggregate.inputs).toEqual(['{workspaceRoot}/docs/guide.md'])
      expect(aggregate.options.files).toEqual(['docs/guide.md', 'docs/guide.md'])
      expect(aggregate.options.blocks).toEqual([0, 1])
      expect(aggregate.options.outputs).toEqual(['docs/guide-1.svg', 'docs/guide-2.svg'])
    })

    it('produces no targets for markdown without diagram fences', () => {
      writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
      writeFileSync(join(workspace, 'README.md'), '# hi\n\n```ts\nconst a = 1\n```\n')

      const result = createNodesV2[1](['README.md'], {}, ctx(workspace))

      expect(result).toEqual([])
    })

    it('handles uppercase .MD extension', () => {
      writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
      writeFileSync(join(workspace, 'G.MD'), '```mermaid\ngraph TD;\n```\n')

      const result = createNodesV2[1](['G.MD'], {}, ctx(workspace))

      expect(mergedTargets(result)['.']?.['diagram-g-1']).toBeDefined()
    })

    it('disambiguates block outputs colliding with file outputs', () => {
      writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
      writeFileSync(join(workspace, 'readme-1.puml'), '@startuml\n@enduml')
      writeFileSync(join(workspace, 'readme.md'), '```mermaid\ngraph TD;\n```\n')

      const result = createNodesV2[1](['readme-1.puml', 'readme.md'], {}, ctx(workspace)),
       targets = mergedTargets(result),

      // Per-file targets only — the aggregate lists the same outputs again.
       outputs = Object.entries(targets['.'] ?? {})
        .filter(([name]) => name !== 'diagrams')
        .flatMap(([, t]) => (t as { outputs: string[] }).outputs)
      // Both nominal `readme-1.svg` collide → each gets its type suffix.
      expect(outputs.sort()).toEqual([
        '{workspaceRoot}/readme-1-mermaid.svg',
        '{workspaceRoot}/readme-1-plantuml.svg',
      ])
    })

    it('applies include/exclude filters to markdown', () => {
      writeFileSync(join(workspace, 'package.json'), '{"name":"root"}')
      mkdirSync(join(workspace, 'docs'), { recursive: true })
      writeFileSync(join(workspace, 'docs/g.md'), '```mermaid\ngraph TD;\n```\n')

      expect(createNodesV2[1](['docs/g.md'], { exclude: ['docs/**'] }, ctx(workspace))).toEqual([])
      const included = createNodesV2[1](['docs/g.md'], { include: ['docs/**'] }, ctx(workspace)),
       targets = mergedTargets(included as Awaited<typeof included>)
      expect(targets['.']?.['diagram-docs-g-1']).toBeDefined()
    })
  })
})
