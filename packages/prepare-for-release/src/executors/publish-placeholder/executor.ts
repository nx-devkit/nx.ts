import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { glob } from 'tinyglobby'
import which from 'which'

export interface NxPrepareForReleaseOptions {
  /** Package scopes to check. Default: derived from packages/* names in the workspace. */
  scope?: string[]
  /** npm dist-tag applied to the placeholder publish. Default: "placeholder". */
  placeholderTag?: string
  /** Version written into the temporary placeholder package.json. Default: "0.0.0". */
  placeholderVersion?: string
  /** npm registry URL. Default: https://registry.npmjs.org/. */
  registry?: string
  /** If true, do not actually publish or pack; just report what would happen. Default: false. */
  dryRun?: boolean
}

export interface PublishPlaceholderResult {
  published: string[]
  skipped: string[]
  trustCommands: string[]
}

export interface PublishPlaceholderContext {
  workspaceRoot: string
  options: NxPrepareForReleaseOptions
}

const DEFAULT_REGISTRY = 'https://registry.npmjs.org/'
const DEFAULT_TAG = 'placeholder'
const DEFAULT_VERSION = '0.0.0'

function resolveNpmCommand(): string {
  const found = which.sync('npm', { nothrow: true })
  return found ?? 'npm'
}

function detectPackageManager(): 'npm' {
  return 'npm'
}

function viewArgs(pkgName: string, registry: string): string[] {
  return ['view', pkgName, 'version', '--registry', registry, '--json']
}

function packArgs(pkgRoot: string, packCwd: string): string[] {
  return ['pack', '--pack-destination', packCwd, '--cwd', pkgRoot]
}

function publishArgs(tarball: string, registry: string, tag: string): string[] {
  return ['publish', tarball, '--access', 'public', '--tag', tag, '--registry', registry]
}

async function readPackageJson(pkgRoot: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(pkgRoot, 'package.json'), 'utf-8')
  return JSON.parse(raw) as Record<string, unknown>
}

async function buildPlaceholderTarball(
  pkgRoot: string,
  pkgName: string,
  placeholderVersion: string,
  registry: string,
): Promise<{ tarballPath: string; tempDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), 'nx-prepare-placeholder-'))
  const stagedPkgRoot = join(tempDir, pkgName)
  await mkdir(stagedPkgRoot, { recursive: true })

  const original = await readPackageJson(pkgRoot)
  const placeholder = {
    ...original,
    name: pkgName,
    version: placeholderVersion,
    description: `Placeholder for ${pkgName} published by @nx-devkit/prepare-for-release.`,
    publishConfig: {
      access: 'public',
      registry,
    },
  }

  const placeholderJson = JSON.stringify(placeholder, null, 2)
  await writeFile(join(stagedPkgRoot, 'package.json'), placeholderJson, 'utf-8')

  const npmCmd = resolveNpmCommand()
  const packResult = spawnSync(npmCmd, packArgs(stagedPkgRoot, tempDir), {
    cwd: tempDir,
    encoding: 'utf-8',
  })

  if (packResult.status !== 0) {
    throw new Error(
      `npm pack failed for ${pkgName} (exit ${packResult.status}): ${packResult.stderr ?? ''}`,
    )
  }

  const stdout = (packResult.stdout ?? '').toString().trim()
  const tarballName = stdout.split('\n').pop()?.trim()
  if (!tarballName) {
    throw new Error(`npm pack produced no tarball name for ${pkgName}`)
  }

  return { tarballPath: join(tempDir, tarballName), tempDir }
}

function isPublished(pkgName: string, registry: string): boolean {
  const npmCmd = resolveNpmCommand()
  const result = spawnSync(npmCmd, viewArgs(pkgName, registry), {
    encoding: 'utf-8',
  })
  if (result.status !== 0) {
    return false
  }
  const stdout = (result.stdout ?? '').toString().trim()
  if (!stdout) return false
  try {
    const parsed = JSON.parse(stdout) as unknown
    if (typeof parsed === 'string') return parsed.length > 0
    if (parsed && typeof parsed === 'object' && 'version' in (parsed as Record<string, unknown>)) {
      return Boolean((parsed as { version?: unknown }).version)
    }
  } catch {
    return stdout.length > 0
  }
  return false
}

function trustCommandFor(pkgName: string): string {
  return `npm trust github --file .github/workflows/release.yml --owner ThePlenkov --repo nx.ts ${pkgName}`
}

export async function publishPlaceholderExecutor(
  ctx: PublishPlaceholderContext,
): Promise<PublishPlaceholderResult> {
  const { workspaceRoot } = ctx
  const registry = ctx.options.registry ?? DEFAULT_REGISTRY
  const placeholderTag = ctx.options.placeholderTag ?? DEFAULT_TAG
  const placeholderVersion = ctx.options.placeholderVersion ?? DEFAULT_VERSION
  const dryRun = ctx.options.dryRun ?? false

  detectPackageManager()

  const pkgDirs = await glob(['packages/*/package.json'], {
    cwd: workspaceRoot,
    onlyFiles: true,
    absolute: true,
  })

  const published: string[] = []
  const skipped: string[] = []
  const trustCommands: string[] = []

  for (const pkgJsonPath of pkgDirs) {
    const pkgRoot = pkgJsonPath.replace(/\/package\.json$/, '')
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as Record<string, unknown>
    } catch {
      continue
    }
    const name = typeof parsed.name === 'string' ? parsed.name : null
    if (!name) continue
    if (ctx.options.scope && ctx.options.scope.length > 0) {
      const matchesScope = ctx.options.scope.some((s) => name.startsWith(s))
      if (!matchesScope) continue
    }

    if (isPublished(name, registry)) {
      skipped.push(name)
      continue
    }

    if (dryRun) {
      published.push(name)
      trustCommands.push(trustCommandFor(name))
      continue
    }

    const { tarballPath, tempDir } = await buildPlaceholderTarball(
      pkgRoot,
      name,
      placeholderVersion,
      registry,
    )

    try {
      const npmCmd = resolveNpmCommand()
      const publishResult = spawnSync(npmCmd, publishArgs(tarballPath, registry, placeholderTag), {
        encoding: 'utf-8',
      })
      if (publishResult.status !== 0) {
        throw new Error(
          `npm publish failed for ${name} (exit ${publishResult.status}): ${publishResult.stderr ?? ''}`,
        )
      }
      published.push(name)
      trustCommands.push(trustCommandFor(name))
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  if (existsSync(join(workspaceRoot, 'scripts/trust-github.sh'))) {
    // Trust commands are also captured in scripts/trust-github.sh when present.
  }

  return { published, skipped, trustCommands }
}

export default publishPlaceholderExecutor
