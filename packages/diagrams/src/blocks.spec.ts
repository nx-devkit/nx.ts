import { describe, expect, it } from 'vitest'
import { extractDiagramBlocks, TYPE_EXTENSIONS } from './blocks.ts'

describe('extractDiagramBlocks', () => {
  it('extracts a mermaid block', () => {
    const blocks = extractDiagramBlocks('# T\n\n```mermaid\ngraph TD; A-->B\n```\n')
    expect(blocks).toEqual([{ index: 0, source: 'graph TD; A-->B\n', type: 'mermaid' }])
  })

  it('extracts multiple blocks of mixed types in order', () => {
    const md = '```mermaid\ngraph TD; A-->B\n```\ntext\n```d2\nx -> y\n```\n'
    const blocks = extractDiagramBlocks(md)
    expect(blocks.map((b) => b.type)).toEqual(['mermaid', 'd2'])
    expect(blocks.map((b) => b.index)).toEqual([0, 1])
  })

  it('ignores non-diagram fences', () => {
    const md = '```ts\nconst a = 1\n```\n```\nno lang\n```\n```bash\nls\n```\n'
    expect(extractDiagramBlocks(md)).toEqual([])
  })

  it('maps language aliases to registry types', () => {
    const md =
      '```puml\n@startuml\n@enduml\n```\n~~~plantuml\n@startuml\n@enduml\n~~~\n```graphviz\ndigraph {}\n```\n```dot\ndigraph {}\n```\n'
    expect(extractDiagramBlocks(md).map((b) => b.type)).toEqual([
      'plantuml',
      'plantuml',
      'graphviz',
      'graphviz',
    ])
  })

  it('supports tilde fences and attributes after the language tag', () => {
    const md = '~~~mermaid\ngraph TD; A-->B\n~~~\n```mermaid {size=small}\ngraph TD; C-->D\n```\n'
    expect(extractDiagramBlocks(md)).toHaveLength(2)
  })

  it('is case-insensitive on the language tag', () => {
    expect(extractDiagramBlocks('```Mermaid\ngraph TD;\n```\n')).toHaveLength(1)
  })

  it('handles CRLF line endings', () => {
    const md = '```mermaid\r\ngraph TD; A-->B\r\n```\r\n'
    expect(extractDiagramBlocks(md)).toEqual([
      { index: 0, source: 'graph TD; A-->B\r\n', type: 'mermaid' },
    ])
  })

  it('does not treat a fence inside a block body as closing', () => {
    // A mermaid block containing an indented ``` line is not a fence opener.
    const md = '```mermaid\ngraph TD\n  A["```"]\n```\n'
    const blocks = extractDiagramBlocks(md)
    expect(blocks).toHaveLength(1)
  })

  it('returns empty for no fences', () => {
    expect(extractDiagramBlocks('plain text')).toEqual([])
  })
})

describe('TYPE_EXTENSIONS', () => {
  it('covers every registry type reachable from fences', () => {
    for (const ext of Object.values(TYPE_EXTENSIONS)) {
      expect(ext.startsWith('.')).toBe(true)
    }
    expect(TYPE_EXTENSIONS.mermaid).toBe('.mmd')
    expect(TYPE_EXTENSIONS.plantuml).toBe('.puml')
  })
})
