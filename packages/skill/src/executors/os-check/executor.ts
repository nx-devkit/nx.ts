import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface OsCheckExecutorOptions {
  /** Relative path (from workspace root) to the skill directory. Required. */
  path: string
}

export interface OsCheckExecutorResult {
  success: boolean
}

const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.zip',
  '.gz',
  '.pdf',
  '.mp4',
])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist'])

// OS-only command patterns. `altRe` names the cross-platform counterparts —
// when a file also documents an alternative for another OS, the command is
// not "OS-only" and is not reported.
const PATTERNS: { re: RegExp; label: string; altRe?: RegExp }[] = [
  { re: /\/Users\/\S+/, label: 'macOS user path (/Users/…)' },
  { re: /\/home\/[a-zA-Z0-9._-]+(\/|$)/, label: 'Linux user path (/home/<user>/…)' },
  { re: /\b[A-Za-z]:[\\/][\w\\/.-]+/, label: 'Windows path (C:\\…)' },
  { re: /\bcmd\.exe\b/i, label: 'cmd.exe invocation', altRe: /\b(bash|zsh|sh)\b/ },
  {
    re: /\bpowershell\b/i,
    label: 'powershell invocation',
    altRe: /\b(bash|zsh|pwsh|sh)\b/,
  },
  {
    re: /\bwinget\b/i,
    label: 'winget (Windows-only)',
    altRe: /\b(brew|apt|apt-get|dnf|yum|pacman|zypper|apk|nix)\b/i,
  },
  {
    re: /\bbrew (install|upgrade)\b/,
    label: 'brew (macOS-only)',
    altRe: /\b(apt|apt-get|dnf|yum|pacman|zypper|apk|winget|choco|nix)\b/i,
  },
]

/**
 * OS-check executor for `@nx-devkit/skill:os-check`.
 *
 * Fails on hardcoded user paths, Windows drive letters, and OS-only commands
 * used without a cross-platform alternative (brew/winget/powershell/cmd.exe).
 */
export async function osCheckExecutor(
  options: OsCheckExecutorOptions,
  context?: { root?: string },
): Promise<OsCheckExecutorResult> {
  const workspaceRoot = context?.root ?? process.cwd()
  const root = resolve(workspaceRoot, options.path)
  const violations: string[] = []

  // Canonical root — a `path` that is itself a symlink must still compare
  // correctly against realpath() results. A missing directory is a
  // violation, not a stack trace.
  let realRoot = ''
  try {
    realRoot = realpathSync(root)
  } catch {
    violations.push(`skill directory does not exist: ${options.path}`)
  }

  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const st = lstatSync(full)
      if (st.isSymbolicLink()) {
        // Symlinks are never followed — flag ones that escape the skill or
        // dangle; both would break a published copy.
        const rel = full.slice(root.length + 1)
        try {
          const real = realpathSync(full)
          const relToRoot = relative(realRoot, real)
          if (relToRoot === '..' || relToRoot.startsWith(`..${sep}`) || isAbsolute(relToRoot)) {
            violations.push(`${rel}: symlink escapes skill directory -> ${real}`)
          }
        } catch {
          violations.push(`${rel}: dangling symlink`)
        }
        continue
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) yield* walk(full)
      } else if (!BINARY_EXT.has(extname(entry).toLowerCase())) {
        yield full
      }
    }
  }

  if (realRoot) {
    try {
      for (const file of walk(root)) {
        const rel = file.slice(root.length + 1)
        const content = readFileSync(file, 'utf8')
        const lines = content.split('\n')
        lines.forEach((line, i) => {
          for (const { re, label, altRe } of PATTERNS) {
            if (re.test(line) && !(altRe && altRe.test(content))) {
              violations.push(`${rel}:${i + 1} ${label}: ${line.trim().slice(0, 100)}`)
            }
          }
        })
      }
    } catch {
      violations.push(`skill directory is not readable: ${options.path}`)
    }
  }

  if (violations.length) {
    for (const v of violations) console.error(`  ✗ ${v}`)
    console.error(`os-check: ${violations.length} violation(s) in ${options.path}`)
    return { success: false }
  }
  console.log(`os-check: ${options.path} OK`)
  return { success: true }
}

export default osCheckExecutor
