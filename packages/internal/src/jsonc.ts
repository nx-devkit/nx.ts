import { parse, type ParseError, parseTree, printParseErrorCode } from 'jsonc-parser'

export function parseJsonObject(text: string, path: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const data = parse(text, errors, { allowTrailingComma: true }) as unknown
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`)
      .join('; ')
    throw new Error(`Cannot parse ${path}: ${details}`)
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`Cannot parse ${path}: expected a JSON object`)
  }
  return data as Record<string, unknown>
}

export function detectIndent(text: string): {
  eol: string
  insertSpaces: boolean
  tabSize: number
} {
  // Anchor on the first real property of the root object so quoted lines
  // Inside comments cannot skew the detected indentation.
  const root = parseTree(text)
  const firstProp = root?.children?.[0]?.children?.[0]
  const lineStart = firstProp ? text.lastIndexOf('\n', firstProp.offset) + 1 : -1
  const leading = firstProp ? text.slice(lineStart, firstProp.offset) : ''
  const indent = /^[ \t]+$/.test(leading) ? leading : '  '
  return {
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    insertSpaces: !indent.startsWith('\t'),
    tabSize: indent.startsWith('\t') ? 1 : indent.length,
  }
}
