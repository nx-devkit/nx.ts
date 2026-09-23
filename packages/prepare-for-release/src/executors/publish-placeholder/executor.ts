import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { glob } from 'tinyglobby'

export interface NxPrepareForReleaseOptions {
  /** Path to a single package.json (workspace-relative or absolute). When set, only that package is processed — used by the per-package `prepare-for-release` target. */
  packageJson?: string
  /** Package scopes to check. Default: derived from packages/* names in the workspace. */
  scope?: string[]
  /** Npm dist-tag applied to the placeholder publish. Default: "placeholder". */
  placeholderTag?: string
  /** Version written into the temporary placeholder package.json. Default: "0.0.0". */
  placeholderVersion?: string
  /** Npm registry URL. Default: https://registry.npmjs.org/. */
  registry?: string
  /** If true, do not actually publish or pack; just report what would happen. Default: false. */
  dryRun?: boolean
  /** If true, run `npm trust github` for all packages including already-published (requires MFA). Default: false. */
  trust?: boolean
  /**
   * `owner/repo` slug used to build the `npm trust github` command.
   * Falls back to `NPM_TRUST_REPO` env var, then `GITHUB_REPOSITORY` env var.
   * Throws if none are set.
   */
  trustRepo?: string
}

export interface PublishPlaceholderResult {
  success: boolean
  published: string[]
  skipped: string[]
  trustCommands: string[]
}

const DEFAULT_REGISTRY = 'https://registry.npmjs.org/',
 DEFAULT_TAG = 'placeholder',
 DEFAULT_VERSION = '0.0.0',
 TRUST_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
 NPM_SUBPROCESS_TIMEOUT_MS = 120_000,

 EOTP_RE = /\bEOTP\b|one-time password/i,
 WEB_AUTH_TIMEOUT_MS = 5 * 60_000,
 WEB_AUTH_POLL_MS = 4000
const WEB_AUTH_FETCH_TIMEOUT_MS = 15_000

interface ResolvedOptions {
  registry: string
  placeholderTag: string
  placeholderVersion: string
  dryRun: boolean
  trust: boolean
  trustRepo: string
  scope: string[] | undefined
  packageJson: string | undefined
}

function resolveOptions(options: NxPrepareForReleaseOptions): ResolvedOptions {
  return {
    dryRun: options.dryRun ?? false,
    packageJson: options.packageJson,
    placeholderTag: options.placeholderTag ?? DEFAULT_TAG,
    placeholderVersion: options.placeholderVersion ?? DEFAULT_VERSION,
    registry: options.registry ?? DEFAULT_REGISTRY,
    scope: options.scope,
    trust: options.trust ?? false,
    trustRepo: resolveTrustRepo(options.trustRepo),
  }
}

function resolveNpmCommand(): string {
  return 'npm'
}

function resolveTrustRepo(option: string | undefined): string {
  const raw =
    option ?? process.env.NPM_TRUST_REPO ?? process.env.GITHUB_REPOSITORY ?? 'nx-devkit/nx.ts'
  if (!TRUST_REPO_RE.test(raw)) {
    throw new Error(
      `Invalid trustRepo "${raw}": expected "owner/repo" slug (e.g. nx-devkit/nx.ts). ` +
        `Override via options.trustRepo or NPM_TRUST_REPO env var.`,
    )
  }
  return raw
}

function detectPackageManager(): 'npm' {
  return 'npm'
}

function viewArgs(pkgName: string, registry: string): string[] {
  return ['view', pkgName, 'version', '--registry', registry, '--json']
}

function packArgs(packDestination: string): string[] {
  return ['pack', '--pack-destination', packDestination]
}

function publishArgs(tarball: string, registry: string, tag: string): string[] {
  return ['publish', tarball, '--access', 'public', '--tag', tag, '--registry', registry]
}

function spawnWithTimeout(
  command: string,
  args: string[],
  options: { cwd?: string; encoding: BufferEncoding; stdio?: 'pipe' | 'inherit' },
): ReturnType<typeof spawnSync> {
  return spawnSync(command, args, {
    ...options,
    timeout: NPM_SUBPROCESS_TIMEOUT_MS,
  })
}

async function readPackageJson(pkgRoot: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(pkgRoot, 'package.json'), 'utf8')
  return JSON.parse(raw) as Record<string, unknown>
}

function readPackageJsonSafe(pkgJsonPath: string): Record<string, unknown> | null {
  let fileContent: string
  try {
    fileContent = readFileSync(pkgJsonPath, 'utf8')
  } catch (error) {
    // Filesystem errors (EACCES, ENOENT on the dir itself) bubble up so the
    // Executor fails loudly rather than silently dropping the workspace.
    if (error instanceof SyntaxError) {
      console.warn(`Skipping ${pkgJsonPath}: invalid JSON (${error.message})`)
      return null
    }
    throw error
  }
  try {
    return JSON.parse(fileContent) as Record<string, unknown>
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn(`Skipping ${pkgJsonPath}: invalid JSON (${error.message})`)
      return null
    }
    throw error
  }
}

function matchesScope(name: string, scope: string[] | undefined): boolean {
  if (!scope || scope.length === 0) {
    return true
  }
  return scope.some((s) => name.startsWith(s))
}

function isNotFoundStderr(stderr: string): boolean {
  return /\b(E404|404|not\s*found|ENOTFOUND_NOT_PUBLISHED)\b/i.test(stderr)
}

async function buildPlaceholderTarball(
  pkgRoot: string,
  pkgName: string,
  placeholderVersion: string,
  registry: string,
): Promise<{ tarballPath: string; tempDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), 'nx-prepare-placeholder-')),
   stagedPkgRoot = join(tempDir, pkgName)

  try {
    await mkdir(stagedPkgRoot, { recursive: true })

    const original = await readPackageJson(pkgRoot),
    // Minimal metadata-only placeholder. Do NOT spread `original`: lifecycle
    // Scripts (prepare/prepack/prepublishOnly) from the source package would
    // Run during `npm pack` and crash because the staged dir has no sources
    // Or node_modules.
     placeholder = {
      author: original.author,
      bugs: original.bugs,
      description: `Placeholder for ${pkgName} published by @nx-devkit/prepare-for-release.`,
      homepage: original.homepage,
      license: typeof original.license === 'string' ? original.license : 'MIT',
      name: pkgName,
      publishConfig: {
        access: 'public',
        registry,
      },
      repository: original.repository,
      type: typeof original.type === 'string' ? original.type : undefined,
      version: placeholderVersion,
    },

     placeholderJson = JSON.stringify(placeholder, null, 2)
    await writeFile(join(stagedPkgRoot, 'package.json'), placeholderJson, 'utf8')

    const npmCmd = resolveNpmCommand(),
     packResult = spawnWithTimeout(npmCmd, packArgs(tempDir), {
      cwd: stagedPkgRoot,
      encoding: 'utf8',
    })

    if (packResult.status !== 0) {
      throw new Error(
        `npm pack failed for ${pkgName} (exit ${packResult.status}): ${packResult.stderr ?? ''}`,
      )
    }

    const stdout = (packResult.stdout ?? '').toString().trim(),
     tarballName = stdout.split('\n').pop()?.trim()
    if (!tarballName) {
      throw new Error(`npm pack produced no tarball name for ${pkgName}`)
    }

    return { tarballPath: join(tempDir, tarballName), tempDir }
  } catch (error) {
    // Best-effort cleanup on any failure so the OS tempdir does not fill up
    // When `npm pack` errors out.
    await rm(tempDir, { force: true, recursive: true }).catch(() => undefined)
    throw error
  }
}

function isPublished(pkgName: string, registry: string): boolean {
  const npmCmd = resolveNpmCommand(),
   result = spawnWithTimeout(npmCmd, viewArgs(pkgName, registry), {
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').toString()
    if (isNotFoundStderr(stderr)) {
      return false
    }
    // Any other npm-view failure (network, auth, registry error) is a hard
    // Error so the executor fails loudly instead of silently republishing.
    throw new Error(
      `npm view failed for ${pkgName} (exit ${result.status}): ${stderr || '<no stderr>'}`,
    )
  }
  const stdout = (result.stdout ?? '').toString().trim()
  if (!stdout) {
    return false
  }
  try {
    const parsed = JSON.parse(stdout) as unknown
    if (typeof parsed === 'string') {
      return parsed.length > 0
    }
    if (parsed && typeof parsed === 'object' && 'version' in (parsed as Record<string, unknown>)) {
      return Boolean((parsed as { version?: unknown }).version)
    }
  } catch {
    return stdout.length > 0
  }
  return false
}

function trustCommandFor(pkgName: string, trustRepo: string, registry?: string): string {
  const base = `npm trust github ${pkgName} --file release.yml --repo ${trustRepo} --allow-publish --yes`
  return registry && registry !== DEFAULT_REGISTRY ? `${base} --registry ${registry}` : base
}

function trustArgs(pkgName: string, trustRepo: string, registry?: string): string[] {
  const args = [
    'trust',
    'github',
    pkgName,
    '--file',
    'release.yml',
    '--repo',
    trustRepo,
    '--allow-publish',
    '--yes',
  ]
  if (registry && registry !== DEFAULT_REGISTRY) {
    args.push('--registry', registry)
  }
  return args
}

function runTrustFor(pkgName: string, trustRepo: string, registry?: string): Promise<void> {
  const npmCmd = resolveNpmCommand()
  return new Promise((resolvePromise, rejectPromise) => {
    // Stderr is piped but forwarded live: npm writes the interactive MFA/OTP
    // Prompt to stderr, so a plain 'pipe' would hide the prompt while the
    // Child blocks on stdin. Tee keeps the prompt visible AND retains a copy
    // For "already trusted" detection.
    const child = spawn(npmCmd, trustArgs(pkgName, trustRepo, registry), {
      stdio: ['inherit', 'inherit', 'pipe'],
    })
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      rejectPromise(new Error(`npm trust github timed out for ${pkgName}`))
    }, NPM_SUBPROCESS_TIMEOUT_MS)
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      process.stderr.write(chunk)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      rejectPromise(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        rejectPromise(
          new Error(
            `npm trust github failed for ${pkgName} (exit ${code})${stderr ? `: ${stderr}` : ''}`,
          ),
        )
        return
      }
      console.log(`  ✓ ${pkgName}`)
      resolvePromise()
    })
  })
}

/**
 * Locate an npm auth token for `registry`: prefers a host-scoped
 * `//host/:_authToken=` entry in `<cwd>/.npmrc`, then `~/.npmrc`, then an
 * unscoped `_authToken=` line. Host-scoped tokens for OTHER registries
 * are never returned — sending one to the wrong host would leak it.
 */
function readNpmAuthToken(registry: string, cwd: string): string | null {
  const url = new URL(registry),
  // Npmrc keys mirror the registry origin+path: //host/path/:_authToken.
  // A bare host has pathname "/", yielding "//host".
   registryKey = `//${url.host}${url.pathname.replace(/\/+$/, '')}`,
   keyRe = new RegExp(
    `${registryKey.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}/:_authToken=(\\S+)`,
  ),
   candidates = [join(cwd, '.npmrc'), join(homedir(), '.npmrc')]
  for (const rcPath of candidates) {
    let text: string
    try {
      text = readFileSync(rcPath, 'utf8')
    } catch {
      continue
    }
    const hostMatch = text.match(keyRe),
     unscopedMatch = text.match(/^\s*_authToken\s*=\s*(\S+)/m),
     match = hostMatch ?? unscopedMatch
    if (match) return match[1]
  }
  return null
}

interface WebAuthUrls {
  authUrl: string
  doneUrl: string
}

/**
 * Npm masks the EOTP auth URL in non-TTY output. Replicating the publish
 * PUT with `npm-auth-type: web` makes the registry return the real
 * authUrl/doneUrl pair in the 401 body.
 */
async function requestWebAuthUrls(
  pkgName: string,
  registry: string,
  token: string,
): Promise<WebAuthUrls> {
  const base = registry.endsWith('/') ? registry.slice(0, -1) : registry,
   res = await fetch(`${base}/${pkgName.replace('/', '%2f')}`, {
    body: '{}',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'npm-auth-type': 'web',
      'npm-command': 'publish',
    },
    method: 'PUT',
    signal: AbortSignal.timeout(WEB_AUTH_FETCH_TIMEOUT_MS),
  }),
   text = await res.text()
  let parsed: Partial<WebAuthUrls> = {}
  try {
    const body: unknown = JSON.parse(text)
    if (typeof body === 'object' && body !== null) {
      parsed = body as Partial<WebAuthUrls>
    }
  } catch {
    // Fall through to the error below
  }
  if (!parsed.authUrl || !parsed.doneUrl) {
    throw new Error(
      `npm web-auth probe for ${pkgName} returned no auth URL (HTTP ${res.status}): ${text}`,
    )
  }
  return { authUrl: parsed.authUrl, doneUrl: parsed.doneUrl }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Poll the registry done endpoint until the web approval yields an OTP. */
async function pollForWebAuthOtp(doneUrl: string, token: string): Promise<string | null> {
  const deadline = Date.now() + WEB_AUTH_TIMEOUT_MS
  while (Date.now() < deadline) {
    const res = await fetch(doneUrl, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(WEB_AUTH_FETCH_TIMEOUT_MS),
    }).catch(() => null)
    if (res?.ok) {
      const body = (await res.json().catch(() => null)) as { otp?: string } | null
      if (body?.otp) return body.otp
    }
    await sleep(WEB_AUTH_POLL_MS)
  }
  return null
}

function runNpmPublish(
  npmCmd: string,
  tarballPath: string,
  resolved: ResolvedOptions,
  otp?: string,
): ReturnType<typeof spawnSync> {
  const args = publishArgs(tarballPath, resolved.registry, resolved.placeholderTag)
  if (otp) args.push('--otp', otp)
  const result = spawnWithTimeout(npmCmd, args, { encoding: 'utf8' })
  // Output is piped (for EOTP detection) then teed so npm notices and
  // Warnings still reach the user's terminal.
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return result
}

async function publishOnePackage(
  pkgRoot: string,
  name: string,
  resolved: ResolvedOptions,
  workspaceRoot: string,
): Promise<void> {
  const { tarballPath, tempDir } = await buildPlaceholderTarball(
    pkgRoot,
    name,
    resolved.placeholderVersion,
    resolved.registry,
  )
  try {
    const npmCmd = resolveNpmCommand()
    let result = runNpmPublish(npmCmd, tarballPath, resolved)
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    if (result.status !== 0 && EOTP_RE.test(output)) {
      const token = readNpmAuthToken(resolved.registry, workspaceRoot)
      if (!token) {
        throw new Error(
          `npm publish requires a one-time password for ${name}, but no npm ` +
            `auth token was found in .npmrc. Run \`npm login\` first.`,
        )
      }
      const { authUrl, doneUrl } = await requestWebAuthUrls(name, resolved.registry, token)
      console.log(
        `\n  npm requires one-time authorization for ${name}.\n` +
          `  Open this URL to approve the publish:\n\n    ${authUrl}\n\n` +
          `  Waiting for approval...`,
      )
      const otp = await pollForWebAuthOtp(doneUrl, token)
      if (!otp) {
        throw new Error(`Timed out waiting for npm web authorization for ${name}`)
      }
      result = runNpmPublish(npmCmd, tarballPath, resolved, otp)
    }
    if (result.status !== 0) {
      const stderr = (result.stderr ?? '').toString()
      throw new Error(
        `npm publish failed for ${name} (exit ${result.status})${stderr ? `: ${stderr}` : ''}`,
      )
    }
  } finally {
    await rm(tempDir, { force: true, recursive: true }).catch(() => undefined)
  }
}

type PackageOutcome = 'published' | 'skipped' | 'ignored'

interface PackageAccumulators {
  published: string[]
  skipped: string[]
  trustCommands: string[]
}

async function processPackage(
  pkgJsonPath: string,
  resolved: ResolvedOptions,
  acc: PackageAccumulators,
  workspaceRoot: string,
): Promise<PackageOutcome> {
  const parsed = readPackageJsonSafe(pkgJsonPath)
  if (!parsed) {
    return 'ignored'
  }
  const name = typeof parsed.name === 'string' ? parsed.name : null
  if (!name || parsed.private === true) {
    return 'ignored'
  }
  if (!matchesScope(name, resolved.scope)) {
    return 'ignored'
  }

  if (isPublished(name, resolved.registry)) {
    acc.skipped.push(name)
    return 'skipped'
  }

  if (resolved.dryRun) {
    acc.published.push(name)
    acc.trustCommands.push(trustCommandFor(name, resolved.trustRepo, resolved.registry))
    return 'published'
  }

  const pkgRoot = dirname(pkgJsonPath)
  await publishOnePackage(pkgRoot, name, resolved, workspaceRoot)
  acc.published.push(name)
  acc.trustCommands.push(trustCommandFor(name, resolved.trustRepo, resolved.registry))
  return 'published'
}

export async function publishPlaceholderExecutor(
  options: NxPrepareForReleaseOptions,
  context: { root: string },
): Promise<PublishPlaceholderResult> {
  const resolved = resolveOptions(options)
  detectPackageManager()

  // Per-package mode (inferred `prepare-for-release` targets) processes a
  // Single manifest; the tools-project mode scans `packages/*` as before.
  const pkgDirs = resolved.packageJson
    ? [
        isAbsolute(resolved.packageJson)
          ? resolved.packageJson
          : join(context.root, resolved.packageJson),
      ]
    : await glob(['packages/*/package.json'], {
        absolute: true,
        cwd: context.root,
        onlyFiles: true,
      }),

   acc: PackageAccumulators = { published: [], skipped: [], trustCommands: [] }
  for (const pkgJsonPath of pkgDirs) {
    await processPackage(pkgJsonPath, resolved, acc, context.root)
  }

  if (existsSync(join(context.root, 'scripts/trust-github.sh'))) {
    // Trust commands are also captured in scripts/trust-github.sh when present.
  }

  if (acc.published.length > 0) {
    console.log(`\nPublished: ${acc.published.join(', ')}`)
  }
  if (acc.skipped.length > 0) {
    console.log(`Skipped:   ${acc.skipped.join(', ')}`)
  }
  if (acc.trustCommands.length > 0 || (resolved.trust && acc.skipped.length > 0)) {
    if (resolved.trust && !resolved.dryRun) {
      const trustTargets = [...acc.published, ...acc.skipped]
      console.log(
        `\nConfiguring GitHub OIDC trusted publishing for ${trustTargets.length} package(s) (requires MFA)...\n`,
      )
      for (const pkgName of trustTargets) {
        try {
          await runTrustFor(pkgName, resolved.trustRepo, resolved.registry)
        } catch (error) {
          if (error instanceof Error && /already.*trust|conflict|exists/i.test(error.message)) {
            console.log(`  ⊙ ${pkgName} (trust already configured)`)
            continue
          }
          throw error
        }
      }
    } else {
      console.log('\nRun these locally (requires MFA) to enable GitHub OIDC trusted publishing:\n')
      for (const cmd of acc.trustCommands) {
        console.log(`  ${cmd}`)
      }
      for (const pkgName of acc.skipped) {
        console.log(`  ${trustCommandFor(pkgName, resolved.trustRepo, resolved.registry)}`)
      }
    }
  }

  return { success: true, ...acc }
}

export default publishPlaceholderExecutor
