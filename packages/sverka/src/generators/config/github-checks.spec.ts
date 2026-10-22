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

  it('reads the default branch instead of assuming main', () => {
    const command = GITHUB_CHECKS['main-green']!.command
    expect(command).toContain('defaultBranchRef')
    expect(command).not.toContain('commits/main/check-runs')
    // The discovered branch is what the API call uses.
    expect(command).toContain('commits/$branch/check-runs')
  })

  it('passes the branch name alone to gh pr list --head', () => {
    const command = GITHUB_CHECKS['stale-branches']!.command
    expect(command).toContain('gh pr list --head "$b"')
    expect(command).not.toContain('--head "$owner:$b"')
    // The owner is a filter, not part of the branch name.
    expect(command).toContain('headRepositoryOwner.login == "')
  })

  it('fails when the remote cannot be queried', () => {
    const command = GITHUB_CHECKS['stale-branches']!.command
    // The status of `git ls-remote` is checked before its output is piped.
    expect(command).toContain(
      'remote=$(git ls-remote --heads origin 2>&1) || { echo "ls-remote failed: $remote"; exit 1; }',
    )
  })

  it('fails when the override token cannot read the dependabot alerts', () => {
    const command = GITHUB_CHECKS['dependabot-alerts']!.command
    expect(command).toContain('if [ -n "$REPO_HEALTH_TOKEN" ]; then')
    expect(command).toContain('exit 1; fi;')
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
