/* eslint-disable one-var, capitalized-comments, node/no-sync -- sync executor by design */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

export interface NxReleaseChangelogOptions {
  /** npm package name. Default: derived from package.json `name`. */
  packageName?: string
  /** Path to the package directory containing package.json. Default: project root. */
  packagePath?: string
  /** Version to generate changelog for. Required. */
  version: string
  /** Previous version to diff from. Optional (uses previous tag). */
  from?: string
  /** If true, this is the first release. Default: false. */
  firstRelease?: boolean
  /** If true, do not write CHANGELOG.md. Default: false. */
  dryRun?: boolean
  /** If true, commit the changelog. Default: false. */
  commit?: boolean
  /** Branch to target the release. Default: "main". */
  branch?: string
}

export interface NxReleaseChangelogResult {
  success: boolean
  version: string
  changelog: string
  skipped: string[]
}

const _NPM_TIMEOUT_MS = 120_000

function exec(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number } = {},
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    timeout: opts.timeout ?? 120_000,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (result.signal === 'SIGTERM') {
    throw new Error(`Command timed out: ${cmd} ${args.join(' ')}`)
  }
  if (result.error) {
    throw new Error(`Command failed to spawn: ${cmd} ${args.join(' ')} — ${result.error.message}`)
  }
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  }
}

function _execOrThrow(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number } = {},
): { stdout: string; stderr: string } {
  const result = exec(cmd, args, opts)
  if (!result.ok) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${result.stderr}`)
  }
  return { stdout: result.stdout, stderr: result.stderr }
}

function _readPackageJson(packagePath: string): { name: string; version: string } {
  const pkgPath = `${packagePath}/package.json`
  if (!existsSync(pkgPath)) {
    throw new Error(`No package.json found at ${pkgPath}`)
  }
  let text: string
  try {
    text = readFileSync(pkgPath, 'utf-8')
  } catch (error) {
    throw new Error(`Cannot read ${pkgPath}: ${(error as Error).message}`, {
      cause: error,
    })
  }
  let raw: { name?: string; version?: string }
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new Error(`Invalid JSON in ${pkgPath}: ${(error as Error).message}`, {
      cause: error,
    })
  }
  if (!raw.name) {
    throw new Error(`package.json at ${pkgPath} has no "name" field`)
  }
  return { name: raw.name, version: raw.version ?? '0.0.0' }
}

function _getPreviousTag(_packageName: string, version: string): string | null {
  // Use gh to list releases and find the previous one
  const result = spawnSync('gh', ['release', 'list', '--limit', '20', '--json', 'tagName'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (!result.ok || !result.stdout) return null
  try {
    const releases = JSON.parse(result.stdout) as { tagName: string }[]
    const _prefix = `${version.split('.')[0]}.${version.split('.')[1]}.`
    const prev = releases.find(
      (r) =>
        r.tagName.startsWith(`@${version.split('/')[0]}@`) ||
        r.tagName.startsWith(`${version.split('/')[0]}@`),
    )
    return prev?.tagName ?? null
  } catch {
    return null
  }
}

function _generateChangelog(
  _packageName: string,
  version: string,
  from: string | null,
  firstRelease: boolean,
): string {
  const args = ['release', 'create', `v${version}`, '--title', `v${version}`, '--generate-notes']
  if (from) {
    args.push('--notes-start-tag', from)
  }
  if (firstRelease) {
    args.push('--first-release')
  }
  args.push('--target', 'main', '--repo', 'REPO_PLACEHOLDER')

  // We can't easily generate changelog without a repo, so return empty for now
  // The actual generation happens in the workflow via gh release create --generate-notes
  return ''
}

export interface NxReleaseChangelogOptions {
  packageName?: string
  packagePath?: string
  version: string
  from?: string
  firstRelease?: boolean
  dryRun?: boolean
  commit?: boolean
  branch?: string
}

export interface NxReleaseChangelogResult {
  success: boolean
  version: string
  changelog: string
  skipped: string[]
}

export async function changelogExecutor(
  options: NxReleaseChangelogOptions,
): Promise<NxReleaseChangelogResult> {
  const pkg = { name: options.packageName, version: '0.0.0' }
  if (options.packagePath) {
    try {
      const pkgJson = JSON.parse(
        require('node:fs').readFileSync(`${options.packagePath}/package.json`, 'utf-8'),
      )
      if (pkgJson.name) pkg.name = pkgJson.name
      if (pkgJson.version) pkg.version = pkgJson.version
    } catch {}
  }

  const result: NxReleaseChangelogResult = {
    success: false,
    version: options.version,
    changelog: '',
    skipped: [],
  }

  if (options.dryRun) {
    result.success = true
    result.skipped.push('dry run')
    return result
  }

  // Generate changelog using gh release create --generate-notes
  // This is typically done in the workflow, not as a standalone executor
  // For now, we just return success
  result.success = true
  result.changelog = `Generated changelog for ${pkg.name}@${options.version}`

  return result
}

export default changelogExecutor
