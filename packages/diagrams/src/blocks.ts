// Fenced code blocks inside Markdown whose language tag maps to a diagram
// registry type. Both ``` and ~~~ fences are recognized; the closing fence
// must use the same marker as the opening one.

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

const FENCE_RE =
  /^(`{3,}|~{3,})[^\S\r\n]*([a-zA-Z0-9]+)[^\S\r\n]*[^\r\n]*\r?\n([\s\S]*?)^\1[^\S\r\n]*$/gm

export function extractDiagramBlocks(markdown: string): DiagramBlock[] {
  const blocks: DiagramBlock[] = []
  for (const match of markdown.matchAll(FENCE_RE)) {
    const lang = match[2]?.toLowerCase()
    // eslint-disable-next-line security/detect-object-injection -- lang comes from the regex; lookup guards with hasOwnProperty semantics via undefined check
    const type = lang ? FENCE_TYPES[lang] : undefined
    if (!type) {
      continue
    }
    blocks.push({ index: blocks.length, source: match[3] ?? '', type })
  }
  return blocks
}
