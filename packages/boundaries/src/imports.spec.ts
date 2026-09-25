import { describe, expect, it } from 'vitest'
import { collectImports } from './imports.ts'

const FILE = 'src/a.ts'

describe('collectImports', () => {
  it('collects static imports, export-from, dynamic import, require', () => {
    const src = `
import a from './a'
import { b } from '@scope/b'
export * from './c'
const d = await import('./d')
const e = require('./e')
`
    const specs = collectImports(FILE, src).map((r) => r.specifier)
    expect(specs).toEqual(['./a', '@scope/b', './c', './d', './e'])
  })

  it('ignores comments and string literals', () => {
    const src = `
// import fake from './nope'
/* import alsoFake from './never' */
const s = "import strFake from './strings'"
const t = \`import tplFake from './templates'\`
`
    expect(collectImports(FILE, src)).toEqual([])
  })

  it('collects import-equals and template-literal specifiers', () => {
    const src = `
import dep = require('./eq')
const m = await import(\`./tpl\`)
const r = require(\`./tplreq\`)
`
    const specs = collectImports(FILE, src).map((r) => r.specifier)
    expect(specs).toEqual(['./eq', './tpl', './tplreq'])
  })

  it('reports 1-based line numbers', () => {
    const src = `const x = 1\nimport y from './y'\n`
    const [record] = collectImports(FILE, src)
    expect(record!.line).toBe(2)
  })
})
