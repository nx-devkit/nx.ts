import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { GITHUB_CHECKS, GITHUB_CHECK_IDS } from './github-checks.ts'

describe('GitHub checks', () => {
  it('ships the documented checks', () => {
    expect(GITHUB_CHECK_IDS.sort()).toEqual([
      'code-scanning',
      'dependabot-alerts',
      'main-green',
      'open-prs',
      'review-debt',
      'secret-scanning',
      'stale-branches',
    ])
  })

  it.each(GITHUB_CHECK_IDS)('%s is valid POSIX shell', (id) => {
    const check = GITHUB_CHECKS[id]!
    const result = spawnSync('sh', ['-n', '-c', check.command], {
      encoding: 'utf8',
      timeout: 10_000,
    })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })
})
