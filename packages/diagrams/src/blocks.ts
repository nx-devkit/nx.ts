// Fenced code blocks inside Markdown whose language tag maps to a diagram
// registry type. Both ``` and ~~~ fences are recognized; the closing fence
// must use the same marker and be at least as long as the opening one.
// Line-scanned, not regex — no backtracking on adversarial input.

/** Fence language tag → registry diagram type. */
export const FENCE_TYPES: Record<string, string> = {
  bpmn: 'bpmn',
  d2: 'd2',
  dot: 'graphviz',
  excalidraw: 'excalidraw',
  graphviz: 'graphviz',
  mermaid: 'mermaid',
  plantuml: 'plantuml',
  puml: 'plantuml',
}

/** Canonical file extension per registry type (temp input files for command overrides). */
export const TYPE_EXTENSIONS: Record<string, string> = {
  bpmn: '.bpmn',
  d2: '.d2',
  excalidraw: '.excalidraw',
  graphviz: '.dot',
  mermaid: '.mmd',
  plantuml: '.puml',
}

export interface DiagramBlock {
  /** 0-based ordinal among diagram fences in the file. */
  index: number
  /** Block body without the fence lines. */
  source: string
  /** Registry diagram type resolved from the language tag. */
  type: string
}

const OPEN_RE = /^(`{3,}|~{3,})[^\S\r\n]*([a-zA-Z0-9]+)[^\S\r\n]*[^\r\n]*$/
const CLOSE_RE = /^(`{3,}|~{3,})[^\S\r\n]*$/

export function extractDiagramBlocks(markdown: string): DiagramBlock[] {
  const blocks: DiagramBlock[] = []
  // Split keeps line endings so block sources survive CRLF files intact.
  const lines = markdown.split(/(?<=\r?\n)/)
  let fenceChar = ''
  let fenceLen = 0
  let body: string[] | null = null
  let type = ''

  for (const line of lines) {
    const stripped = line.replace(/\r?\n$/, '')
    if (body === null) {
      const open = stripped.match(OPEN_RE)
      const lang = open?.[2]?.toLowerCase()
      // eslint-disable-next-line security/detect-object-injection -- lang is a regex capture; undefined lookup returns undefined
      const mapped = lang ? FENCE_TYPES[lang] : undefined
      if (open && mapped) {
        fenceChar = open[1]?.[0] ?? '`'
        fenceLen = open[1]?.length ?? 3
        body = []
        type = mapped
      }
    } else {
      const close = stripped.match(CLOSE_RE)
      if (close && close[1]?.[0] === fenceChar && close[1].length >= fenceLen) {
        blocks.push({ index: blocks.length, source: body.join(''), type })
        body = null
      } else {
        body.push(line)
      }
    }
  }
  // An unclosed fence at EOF is not a diagram block — dropped with `body`.
  return blocks
}
