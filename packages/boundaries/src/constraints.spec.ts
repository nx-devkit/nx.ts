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

  it('requires every matching constraint to pass', () => {
    const strict = [
      { sourceTag: 'a', onlyDependOnLibsWithTags: ['x'] },
      { sourceTag: 'b', onlyDependOnLibsWithTags: ['y'] },
    ]
    expect(isAllowed(['a', 'b'], ['x'], strict)).toBe(false) // 'b' constraint fails
    expect(isAllowed(['a', 'b'], ['x', 'y'], strict)).toBe(true)
  })
})
