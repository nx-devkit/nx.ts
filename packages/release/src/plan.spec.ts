import { describe, expect, it } from 'vitest'
import { compareVersions, planRelease, releaseBaseline, type ReleasePackage } from './plan.js'

const packages: ReleasePackage[] = [
  { name: '@nx-devkit/release', path: 'packages/release', version: '0.0.22' },
  { name: '@nx-devkit/typescript', path: 'packages/typescript', version: '0.2.19' },
  { name: '@nx-devkit/cspell', path: 'packages/cspell', version: '0.0.3' },
]

describe('planRelease', () => {
  it('publishes the changed packages with the release version', () => {
    const plan = planRelease({
      packages,
      baseline: '0.2.19',
      bump: 'minor',
      changed: ['@nx-devkit/release'],
      date: '2026-10-22',
    })

    expect(plan.version).toBe('0.3.0')
    expect(plan.publish).toEqual([
      { name: '@nx-devkit/release', path: 'packages/release', version: '0.3.0' },
    ])
  })

  it('skips a package whose content did not change', () => {
    const plan = planRelease({
      packages,
      baseline: '0.2.19',
      bump: 'patch',
      changed: ['@nx-devkit/cspell'],
      date: '2026-10-22',
    })

    expect(plan.version).toBe('0.2.20')
    expect(plan.publish.map((pkg) => pkg.name)).toEqual(['@nx-devkit/cspell'])
    expect(plan.skipped).toEqual([
      { name: '@nx-devkit/release', reason: 'unchanged since the last release' },
      { name: '@nx-devkit/typescript', reason: 'unchanged since the last release' },
    ])
  })

  it('gives every published package the same version', () => {
    const plan = planRelease({
      packages,
      baseline: '0.2.19',
      bump: 'major',
      changed: ['@nx-devkit/release', '@nx-devkit/cspell'],
      date: '2026-10-22',
    })

    expect(plan.version).toBe('1.0.0')
    expect(new Set(plan.publish.map((pkg) => pkg.version))).toEqual(new Set(['1.0.0']))
  })

  it('renders a changelog for every published package only', () => {
    const plan = planRelease({
      packages,
      baseline: '0.2.19',
      bump: 'minor',
      changed: ['@nx-devkit/release'],
      changes: {
        '@nx-devkit/release': [
          { type: 'feat', scope: 'release', breaking: false, description: 'plan the release' },
        ],
      },
      date: '2026-10-22',
    })

    expect(plan.changelogs).toHaveLength(1)
    expect(plan.changelogs[0]!.name).toBe('@nx-devkit/release')
    expect(plan.changelogs[0]!.content).toContain('## 0.3.0 (2026-10-22)')
    expect(plan.changelogs[0]!.content).toContain('plan the release')
  })

  it('publishes nothing when no package changed', () => {
    const plan = planRelease({
      packages,
      baseline: '0.2.19',
      bump: 'patch',
      changed: [],
      date: '2026-10-22',
    })

    expect(plan.publish).toEqual([])
    expect(plan.changelogs).toEqual([])
    expect(plan.skipped).toHaveLength(3)
  })
})

describe('releaseBaseline', () => {
  it('takes the highest current version', () => {
    expect(releaseBaseline(packages)).toBe('0.2.19')
  })

  it('fails without packages', () => {
    expect(() => releaseBaseline([])).toThrow(/no packages/)
  })
})

describe('compareVersions', () => {
  it('orders by major, minor and patch', () => {
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.2.19', '0.2.9')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0)
  })

  it('puts a pre-release before the release it leads to', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-rc.1', '1.0.0-rc.2')).toBe(0)
  })
})
