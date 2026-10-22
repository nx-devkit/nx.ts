import { describe, expect, it } from 'vitest'
import { deriveBump, nextVersion, parseConventionalCommit } from './version.ts'

describe('parseConventionalCommit', () => {
  it('parses a type and a description', () => {
    expect(parseConventionalCommit('feat: add a target')).toEqual({
      type: 'feat',
      scope: undefined,
      breaking: false,
      description: 'add a target',
    })
  })

  it('parses a scope', () => {
    expect(parseConventionalCommit('fix(sverka): stop the leak')).toEqual({
      type: 'fix',
      scope: 'sverka',
      breaking: false,
      description: 'stop the leak',
    })
  })

  it('marks a breaking change', () => {
    expect(parseConventionalCommit('feat!: drop the old option')?.breaking).toBe(true)
    expect(parseConventionalCommit('feat(scope)!: drop it')?.breaking).toBe(true)
  })

  it('marks a breaking change from the commit body', () => {
    expect(
      parseConventionalCommit('feat: change the api', 'BREAKING CHANGE: the old option is gone')
        ?.breaking,
    ).toBe(true)
    expect(parseConventionalCommit('feat: change the api', 'BREAKING-CHANGE: gone')?.breaking).toBe(
      true,
    )
    expect(parseConventionalCommit('feat: change the api', 'just a note')?.breaking).toBe(false)
  })

  it('returns undefined for a subject without the convention', () => {
    expect(parseConventionalCommit('just a message')).toBeUndefined()
    expect(parseConventionalCommit('feat:')).toBeUndefined()
    expect(parseConventionalCommit('feat: ')).toBeUndefined()
  })

  it('rejects a numeric commit type', () => {
    expect(parseConventionalCommit('123: not a type')).toBeUndefined()
  })
})

describe('deriveBump', () => {
  const commit = (type: string, breaking = false) => ({
    type,
    scope: undefined,
    breaking,
    description: 'x',
  })

  it('returns undefined when nothing is releasable', () => {
    expect(deriveBump([commit('docs'), commit('chore')])).toBeUndefined()
    expect(deriveBump([])).toBeUndefined()
  })

  it('derives a patch for a fix', () => {
    expect(deriveBump([commit('fix')])).toBe('patch')
  })

  it('derives a minor for a feature', () => {
    expect(deriveBump([commit('feat')])).toBe('minor')
  })

  it('derives a major for a breaking change', () => {
    expect(deriveBump([commit('feat', true)])).toBe('major')
  })

  it('takes the strongest bump', () => {
    expect(deriveBump([commit('fix'), commit('feat'), commit('docs')])).toBe('minor')
    expect(deriveBump([commit('fix'), commit('feat', true)])).toBe('major')
  })
})

describe('nextVersion', () => {
  it('bumps the patch', () => {
    expect(nextVersion('0.2.18', 'patch')).toBe('0.2.19')
  })

  it('bumps the minor and resets the patch', () => {
    expect(nextVersion('0.2.18', 'minor')).toBe('0.3.0')
  })

  it('bumps the major and resets minor and patch', () => {
    expect(nextVersion('0.2.18', 'major')).toBe('1.0.0')
  })

  it('accepts a prerelease version', () => {
    expect(nextVersion('0.2.18-beta.1', 'patch')).toBe('0.2.19')
  })

  it('rejects a version that is not semver', () => {
    expect(() => nextVersion('nope', 'patch')).toThrow(/not a semver version/)
  })
})
