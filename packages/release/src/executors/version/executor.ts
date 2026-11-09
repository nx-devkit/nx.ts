/* eslint-disable one-var, capitalized-comments, node/no-sync -- sync executor by design */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

export interface NxReleaseVersionOptions {
  /** npm package name. Default: derived from package.json `name`. */
  packageName?: string
  /** Path to the package directory containing package.json. Default: project root. */
  packagePath?: string
  /** Version to release (x.y.z, or patch|minor|major vs npm latest). Default: "patch". */
  releaseVersion?: string
  /** If true, do not commit, tag, or push. Default: false. */
  dryRun?: boolean
  /** npm registry URL. Default: https://registry.npmjs.org/. */
  registry?: string
  /** Branch to push the bump commit to. Default: "main". */
  branch?: string
  /** If true, create a GitHub Release with auto-generated changelog. Default: true. */
  generateNotes?: boolean
  /** If true, publish with --provenance (npm OIDC). Default: true. */
  provenance?: boolean
}

export interface NxReleaseVersionResult {
  success: boolean
  version: string
  committed: boolean
  tagged: boolean
  releaseCreated: boolean
  skipped: string[]
}

const _DEFAULT_REGISTRY = 'https://registry.npmjs.org/'
const _DEFAULT_BRANCH = 'main'
const _SEMVER_RE = /^\d+\.\d+\.\d+(-[\dA-Za-z.-]+)?$/
const NPM_TIMEOUT_MS = 120_000

interface ResolvedOptions {
  packageName: string
  packagePath: string
  version: string
  dryRun: boolean
  registry: string
  branch: string
  generateNotes: boolean
  provenance: boolean
}

function readPackageJson(packagePath: string): { name: string; version: string } {
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

function exec(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number } = {},
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    timeout: opts.timeout ?? NPM_TIMEOUT_MS,
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

function execOrThrow(
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

function npmViewVersion(packageName: string, registry: string): string | null {
  const result = exec('npm', ['view', packageName, 'version', '--registry', registry])
  return result.ok && result.stdout ? result.stdout : null
}

function gitRemoteTagSha(tag: string): string | null {
  const result = exec('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`])
  if (!result.ok) {
    throw new Error(`Cannot query remote tag ${tag}: ${result.stderr}`)
  }
  if (!result.stdout) return null
  const lines = result.stdout.split('\n')
  const ref =
    lines.find((l) => l.endsWith(`\trefs/tags/${tag}^{}`)) ??
    lines.find((l) => l.endsWith(`\trefs/tags/${tag}`))
  return ref?.split('\t')[0] || null
}

function tagCarriesVersion(packagePath: string, tag: string, version: string): boolean {
  const fetched = exec('git', ['fetch', '--depth=1', 'origin', `refs/tags/${tag}`])
  if (!fetched.ok) {
    throw new Error(`Cannot fetch remote tag ${tag} to verify its target: ${fetched.stderr}`)
  }
  const shown = exec('git', ['show', 'FETCH_HEAD:./package.json'], { cwd: packagePath })
  if (!shown.ok) return false
  try {
    return (JSON.parse(shown.stdout) as { version?: string }).version === version
  } catch {
    return false
  }
}

function assertTagTarget(
  version: string,
  tag: string,
  remoteTagSha: string,
  nextVersion: string,
): void {
  const match = tagCarriesVersion(version, tag, nextVersion)
  if (!match) {
    throw new Error(
      `Remote tag ${tag} points at ${remoteTagSha.slice(0, 12)} — refusing to attach the ${nextVersion} release to a stale tag`,
    )
  }
}

function ghReleaseExists(tag: string): boolean {
  return exec('gh', ['release', 'view', tag]).ok
}

function computeNextVersion(
  requested: string,
  packageName: string,
  localVersion: string,
  registry: string,
): string {
  const SEMVER_RE = /^\d+\.\d+\.\d+(-[\dA-Za-z.-]+)?$/
  if (SEMVER_RE.test(requested)) {
    return requested
  }
  if (!['patch', 'minor', 'major'].includes(requested)) {
    throw new Error(`Invalid version: ${requested}. Use x.y.z or patch|minor|major.`)
  }
  const npmVersion = npmViewVersion(packageName, registry)
  if (npmVersion && compareSemver(npmVersion, localVersion) > 0) {
    return npmVersion
  }
  return bumpSemver(localVersion, requested as 'patch' | 'minor' | 'major')
}

function compareSemver(a: string, b: string): number {
  const [aMain = '0', aPre] = a.split('-', 2)
  const [bMain = '0', bPre] = b.split('-', 2)
  const pa = aMain.split('.').map(Number)
  const pb = bMain.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da > db) return 1
    if (da < db) return -1
  }
  if (aPre === bPre) return 0
  if (!aPre) return 1
  if (!bPre) return -1
  return aPre.localeCompare(bPre, 'en', { numeric: true }) < 0 ? -1 : 1
}

function bumpSemver(base: string, kind: 'patch' | 'minor' | 'major'): string {
  if (!/^\d+\.\d+\.\d+(-[\dA-Za-z.-]+)?$/.test(base)) {
    throw new Error(`Cannot bump invalid version: ${base}`)
  }
  const [main, pre] = base.split('-', 2)
  const [maj, min, pat] = (main ?? '0.0.0').split('.').map(Number)
  if (kind === 'major') return `${(maj ?? 0) + 1}.0.0`
  if (kind === 'minor') return `${maj ?? 0}.${(min ?? 0) + 1}.0`
  return `${maj ?? 0}.${min ?? 0}.${(pat ?? 0) + (pre ? 0 : 1)}`
}

function _gitConfigBot(): void {
  execOrThrow('git', ['config', 'user.name', 'github-actions[bot]'])
  execOrThrow('git', [
    'config',
    'user.email',
    '41898282+github-actions[bot]@users.noreply.github.com',
  ])
}

function _stampVersion(packagePath: string, version: string): void {
  execOrThrow('npm', ['version', version, '--no-git-tag-version', '--allow-same-version'], {
    cwd: packagePath,
  })
}

function _commitBumpFiles(packagePath: string, version: string): void {
  execOrThrow('git', ['add', `${packagePath}/package.json`])
  const lockfiles = ['package-lock.json']
  if (packagePath !== '.') lockfiles.push(`${packagePath}/package-lock.json`)
  for (const lockfile of lockfiles) {
    if (existsSync(lockfile)) execOrThrow('git', ['add', lockfile])
  }
  const diffResult = exec('git', ['diff', '--cached', '--quiet'])
  if (!diffResult.ok) {
    execOrThrow('git', ['commit', '-m', `chore: release ${version}`])
  }
}

function assertCleanTree(): void {
  const dirty = exec('git', ['status', '--porcelain'])
  if (dirty.ok && dirty.stdout) {
    throw new Error('Working tree is dirty — commit or stash changes before releasing')
  }
}

function assertSafeGitRef(value: string, name: string): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) ||
    value.includes('..') ||
    value.includes('@{')
  ) {
    throw new Error(`Invalid ${name}: "${value}" — expected a plain git ref name`)
  }
  return value
}

function _emptyResult(): VersionResult {
  return {
    success: false,
    version: '',
    committed: false,
    tagged: false,
    releaseCreated: false,
    skipped: [],
  }
}

interface VersionResult {
  success: boolean
  version: string
  committed: boolean
  tagged: boolean
  releaseCreated: boolean
  skipped: string[]
}

interface ResolvedOptions {
  packageName: string
  packagePath: string
  version: string
  dryRun: boolean
  registry: string
  branch: string
  generateNotes: boolean
  provenance: boolean
}

function resolveOptions(
  options: NxReleaseVersionOptions,
  pkg: { name: string; version: string },
): ResolvedOptions {
  return {
    packageName: options.packageName ?? pkg.name,
    packagePath: options.packagePath ?? '.',
    version: options.releaseVersion ?? 'patch',
    dryRun: options.dryRun ?? false,
    registry: options.registry ?? 'https://registry.npmjs.org/',
    branch: assertSafeGitRef(options.branch ?? 'main', 'branch'),
    generateNotes: options.generateNotes ?? true,
    provenance: options.provenance ?? true,
  }
}

function _checkReleaseState(resolved: ResolvedOptions, tag: string, nextVersion: string) {
  const alreadyPublished =
    npmViewVersion(`${resolved.packageName}@${nextVersion}`, resolved.registry) === nextVersion
  const remoteTagSha = gitRemoteTagSha(tag)
  if (remoteTagSha) assertTagTarget(resolved.packagePath, tag, remoteTagSha, nextVersion)
  const alreadyTagged = remoteTagSha !== null
  const alreadyReleased = alreadyTagged && ghReleaseExists(tag)
  return { alreadyPublished, alreadyTagged, alreadyReleased }
}

function stampVersion(packagePath: string, version: string): void {
  execOrThrow('npm', ['version', version, '--no-git-tag-version', '--allow-same-version'], {
    cwd: packagePath,
  })
}

function commitBumpFiles(packagePath: string, version: string): void {
  execOrThrow('git', ['add', `${packagePath}/package.json`])
  const lockfiles = ['package-lock.json']
  if (packagePath !== '.') lockfiles.push(`${packagePath}/package-lock.json`)
  for (const lockfile of lockfiles) {
    if (existsSync(lockfile)) execOrThrow('git', ['add', lockfile])
  }
  const diffResult = exec('git', ['diff', '--cached', '--quiet'])
  if (!diffResult.ok) {
    execOrThrow('git', ['commit', '-m', `chore: release ${version}`])
  }
}

function gitConfigBot(): void {
  execOrThrow('git', ['config', 'user.name', 'github-actions[bot]'])
  execOrThrow('git', [
    'config',
    'user.email',
    '41898282+github-actions[bot]@users.noreply.github.com',
  ])
}

function _stampVersionFile(packagePath: string, version: string): void {
  execOrThrow('npm', ['version', version, '--no-git-tag-version', '--allow-same-version'], {
    cwd: packagePath,
  })
}

function _commitBumpFilesFull(packagePath: string, version: string): void {
  execOrThrow('git', ['add', `${packagePath}/package.json`])
  const lockfiles = ['package-lock.json']
  if (packagePath !== '.') lockfiles.push(`${packagePath}/package-lock.json`)
  for (const lockfile of lockfiles) {
    if (existsSync(lockfile)) execOrThrow('git', ['add', lockfile])
  }
  const diffResult = exec('git', ['diff', '--cached', '--quiet'])
  if (!diffResult.ok) {
    execOrThrow('git', ['commit', '-m', `chore: release ${version}`])
  }
}

function _gitConfigBotImpl(): void {
  execOrThrow('git', ['config', 'user.name', 'github-actions[bot]'])
  execOrThrow('git', [
    'config',
    'user.email',
    '41898282+github-actions[bot]@users.noreply.github.com',
  ])
}

function _assertCleanTreeImpl(): void {
  const dirty = exec('git', ['status', '--porcelain'])
  if (dirty.ok && dirty.stdout) {
    throw new Error('Working tree is dirty — commit or stash changes before releasing')
  }
}

function _assertSafeGitRefImpl(value: string, name: string): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) ||
    value.includes('..') ||
    value.includes('@{')
  ) {
    throw new Error(`Invalid ${name}: "${value}" — expected a plain git ref name`)
  }
  return value
}

function execImpl(
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

function npmViewVersionImpl(packageName: string, registry: string): string | null {
  const result = execImpl('npm', ['view', packageName, 'version', '--registry', registry])
  return result.ok && result.stdout ? result.stdout : null
}

function _gitRemoteTagShaImpl(tag: string): string | null {
  const result = execImpl('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`])
  if (!result.ok) {
    throw new Error(`Cannot query remote tag ${tag}: ${result.stderr}`)
  }
  if (!result.stdout) return null
  const lines = result.stdout.split('\n')
  const ref =
    lines.find((l) => l.endsWith(`\trefs/tags/${tag}^{}`)) ??
    lines.find((l) => l.endsWith(`\trefs/tags/${tag}`))
  return ref?.split('\t')[0] || null
}

function _tagCarriesVersionImpl(packagePath: string, tag: string, version: string): boolean {
  const fetched = execImpl('git', ['fetch', '--depth=1', 'origin', `refs/tags/${tag}`])
  if (!fetched.ok) {
    throw new Error(`Cannot fetch remote tag ${tag} to verify its target: ${fetched.stderr}`)
  }
  const shown = execImpl('git', ['show', 'FETCH_HEAD:./package.json'], { cwd: packagePath })
  if (!shown.ok) return false
  try {
    return (JSON.parse(shown.stdout) as { version?: string }).version === version
  } catch {
    return false
  }
}

function _ghReleaseExistsImpl(tag: string): boolean {
  return execImpl('gh', ['release', 'view', tag]).ok
}

function _computeNextVersionImpl(
  requested: string,
  packageName: string,
  localVersion: string,
  registry: string,
): string {
  const SEMVER_RE = /^\d+\.\d+\.\d+(-[\dA-Za-z.-]+)?$/
  if (SEMVER_RE.test(requested)) {
    return requested
  }
  if (!['patch', 'minor', 'major'].includes(requested)) {
    throw new Error(`Invalid version: ${requested}. Use x.y.z or patch|minor|major.`)
  }
  const npmVersion = npmViewVersionImpl(packageName, registry)
  if (npmVersion && compareSemverImpl(npmVersion, localVersion) > 0) {
    return npmVersion
  }
  return bumpSemverImpl(localVersion, requested as 'patch' | 'minor' | 'major')
}

function compareSemverImpl(a: string, b: string): number {
  const [aMain = '0', aPre] = a.split('-', 2)
  const [bMain = '0', bPre] = b.split('-', 2)
  const pa = aMain.split('.').map(Number)
  const pb = bMain.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da > db) return 1
    if (da < db) return -1
  }
  if (aPre === bPre) return 0
  if (!aPre) return 1
  if (!bPre) return -1
  return aPre.localeCompare(bPre, 'en', { numeric: true }) < 0 ? -1 : 1
}

function bumpSemverImpl(base: string, kind: 'patch' | 'minor' | 'major'): string {
  if (!/^\d+\.\d+\.\d+(-[\dA-Za-z.-]+)?$/.test(base)) {
    throw new Error(`Cannot bump invalid version: ${base}`)
  }
  const [main, pre] = base.split('-', 2)
  const [maj, min, pat] = (main ?? '0.0.0').split('.').map(Number)
  if (kind === 'major') return `${(maj ?? 0) + 1}.0.0`
  if (kind === 'minor') return `${maj ?? 0}.${(min ?? 0) + 1}.0`
  return `${maj ?? 0}.${min ?? 0}.${(pat ?? 0) + (pre ? 0 : 1)}`
}

export async function versionExecutor(
  options: NxReleaseVersionOptions = {},
): Promise<NxReleaseVersionResult> {
  const pkg = readPackageJson(options.packagePath ?? '.')
  const resolved = resolveOptions(options, pkg)
  const result: NxReleaseVersionResult = {
    success: false,
    version: '',
    committed: false,
    tagged: false,
    releaseCreated: false,
    skipped: [],
  }

  const SEMVER_RE = /^\d+\.\d+\.\d+(-[\dA-Za-z.-]+)?$/
  if (pkg.version === '0.0.0' || !SEMVER_RE.test(pkg.version)) {
    throw new Error(
      `version executor requires a committed semver version in package.json (got "${pkg.version}")`,
    )
  }

  const nextVersion = computeNextVersion(
    resolved.version,
    resolved.packageName,
    pkg.version,
    resolved.registry,
  )
  result.version = nextVersion
  const tag = `v${nextVersion}`

  const npmVersion = npmViewVersion(`${resolved.packageName}@${nextVersion}`, resolved.registry)
  const alreadyPublished = npmVersion === nextVersion
  const remoteTagSha = gitRemoteTagSha(`v${nextVersion}`)
  if (remoteTagSha)
    assertTagTarget(resolved.packagePath, `v${nextVersion}`, remoteTagSha, nextVersion)
  const alreadyTagged = remoteTagSha !== null
  const alreadyReleased = alreadyTagged && ghReleaseExists(`v${nextVersion}`)

  if (alreadyPublished && alreadyTagged && alreadyReleased) {
    result.success = true
    result.skipped.push('already published, tagged, and released')
    return result
  }

  if (options.dryRun) {
    result.success = true
    result.skipped.push('dry run')
    return result
  }

  assertCleanTree()

  gitConfigBot()

  if (pkg.version !== nextVersion) {
    stampVersion(options.packagePath ?? '.', nextVersion)
    commitBumpFiles(options.packagePath ?? '.', nextVersion)
    result.committed = true
  }

  execOrThrow('git', ['tag', tag])
  result.tagged = true
  execOrThrow('git', ['push', 'origin', tag])

  if (options.generateNotes) {
    const releaseResult = exec('gh', [
      'release',
      'create',
      tag,
      '--title',
      tag,
      '--generate-notes',
      '--target',
      options.branch ?? 'main',
    ])
    if (releaseResult.ok) {
      result.releaseCreated = true
    } else {
      result.skipped.push(`release creation failed: ${releaseResult.stderr}`)
    }
  }

  result.success = true
  return result
}

export default versionExecutor
