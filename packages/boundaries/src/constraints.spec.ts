import { describe, expect, it } from 'vitest'
import { isAllowed } from './constraints.ts'

const constraints = [
  { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:feature', 'type:util'] },
  { sourceTag: 'type:feature', onlyDependOnLibsWithTags: ['type:feature', 'type:util'] },
]

describe('isAllowed', () => {
  it('allows imports matching onlyDependOnLibsWithTags', () => {
    expect(isAllowed(['type:app'], ['type:util'], constraints)).toBe(true)
    expect(isAllowed(['type:feature'], ['type:feature'], constraints)).toBe(true)
  })

  it('rejects imports outside the allowed set', () => {
    expect(isAllowed(['type:feature'], ['type:app'], constraints)).toBe(false)
    expect(isAllowed(['type:util'], ['type:app'], constraints)).toBe(true) // Util unconstrained
  })

  it('rejects untagged targets when a constraint applies', () => {
    expect(isAllowed(['type:app'], [], constraints)).toBe(false)
  })

  it('is permissive when no constraint matches the source tags', () => {
    expect(isAllowed(['scope:x'], ['type:app'], constraints)).toBe(true)
    expect(isAllowed([], ['type:app'], constraints)).toBe(true)
  })

  it('an empty allowlist permits only untagged targets', () => {
    const tagless = [{ sourceTag: 'type:app', onlyDependOnLibsWithTags: [] }]
    expect(isAllowed(['type:app'], [], tagless)).toBe(true)
    expect(isAllowed(['type:app'], ['type:util'], tagless)).toBe(false)
  })

  it('requires every matching constraint to pass', () => {
    const strict = [
      { sourceTag: 'a', onlyDependOnLibsWithTags: ['x'] },
      { sourceTag: 'b', onlyDependOnLibsWithTags: ['y'] },
    ]
    expect(isAllowed(['a', 'b'], ['x'], strict)).toBe(false) // 'b' constraint fails
    expect(isAllowed(['a', 'b'], ['x', 'y'], strict)).toBe(true)
  })

  it('sourceTag "*" applies to tagged sources but keeps untagged sources permissive', () => {
    const star = [{ sourceTag: '*', onlyDependOnLibsWithTags: ['type:util'] }]
    expect(isAllowed(['type:app'], ['type:util'], star)).toBe(true)
    expect(isAllowed(['type:app'], ['type:feature'], star)).toBe(false)
    expect(isAllowed([], ['type:feature'], star)).toBe(true) // untagged source: no constraint
  })

  it('onlyDependOnLibsWithTags "*" requires the target to carry at least one tag', () => {
    const star = [{ sourceTag: 'type:app', onlyDependOnLibsWithTags: ['*'] }]
    expect(isAllowed(['type:app'], ['anything'], star)).toBe(true)
    expect(isAllowed(['type:app'], [], star)).toBe(false)
  })

  it('supports partial globs like "scope:*"', () => {
    const glob = [{ sourceTag: 'scope:*', onlyDependOnLibsWithTags: ['scope:*'] }]
    expect(isAllowed(['scope:a'], ['scope:b'], glob)).toBe(true)
    expect(isAllowed(['scope:a'], ['other:b'], glob)).toBe(false)
    expect(isAllowed(['other:a'], ['scope:b'], glob)).toBe(true) // source doesn't match
  })
})
