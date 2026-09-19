import { describe, expect, it } from 'vitest'
import { detectIndent, parseJsonObject } from './jsonc.ts'

describe('parseJsonObject', () => {
  it('parses JSONC with comments and trailing commas', () => {
    expect(parseJsonObject('{\n  // c\n  "a": 1,\n}', 'x.json')).toEqual({ a: 1 })
  })

  it('throws on invalid JSON', () => {
    expect(() => parseJsonObject('{nope', 'x.json')).toThrow('Cannot parse x.json')
  })

  it('throws on non-object roots', () => {
    expect(() => parseJsonObject('[1]', 'x.json')).toThrow('expected a JSON object')
  })
})

describe('detectIndent', () => {
  it('detects spaces from the first real property', () => {
    expect(detectIndent('{\n    "a": 1\n}').tabSize).toBe(4)
  })

  it('detects tabs', () => {
    const result = detectIndent('{\n\t"a": 1\n}')
    expect(result.insertSpaces).toBe(false)
    expect(result.tabSize).toBe(1)
  })

  it('ignores quoted lines inside block comments', () => {
    const text = '{\n  /*\n        "plugins": example\n  */\n  "plugins": []\n}'
    expect(detectIndent(text).tabSize).toBe(2)
  })

  it('ignores comments before the first property', () => {
    const text = '{\n  // "quoted": comment\n      "a": 1\n}'
    expect(detectIndent(text).tabSize).toBe(6)
  })

  it('falls back to two spaces when the first key shares the brace line', () => {
    expect(detectIndent('{"a": 1}').tabSize).toBe(2)
  })

  it('detects CRLF line endings', () => {
    expect(detectIndent('{\r\n\t"a": 1\r\n}').eol).toBe('\r\n')
  })
})
