#!/usr/bin/env tsx
/**
 * check-os-independence — flag platform-specific content in a skill directory.
 *
 * Usage: tsx scripts/check-os-independence.ts --skill <dir>
 *
 * Fails on hardcoded user paths, Windows drive letters, and OS-only commands
 * used without a cross-platform alternative (brew/winget/powershell/cmd.exe).
 * Exit 0 when clean, 1 on violations.
 */
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

const skillArg = process.argv.indexOf('--skill')
const skillDir = skillArg !== -1 ? process.argv[skillArg + 1] : undefined
if (!skillDir) {
  console.error('Usage: check-os-independence.ts --skill <dir>')
  process.exit(1)
}

const root = resolve(skillDir)
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

const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\/Users\/\S+/, label: 'macOS user path (/Users/…)' },
  { re: /\/home\/[a-zA-Z0-9._-]+\//, label: 'Linux user path (/home/<user>/…)' },
  { re: /\b[A-Za-z]:\\[\w\\.-]+/, label: 'Windows path (C:\\…)' },
  { re: /\bcmd\.exe\b/i, label: 'cmd.exe invocation' },
  { re: /\bpowershell\b/i, label: 'powershell invocation' },
  { re: /\bwinget\b/i, label: 'winget (Windows-only)' },
  { re: /\bbrew (install|upgrade)\b/, label: 'brew (macOS-only)' },
]

const violations: string[] = []

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
        if (real !== root && !real.startsWith(root + '/')) {
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

for (const file of walk(root)) {
  const rel = file.slice(root.length + 1)
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const { re, label } of PATTERNS) {
      if (re.test(line)) {
        violations.push(`${rel}:${i + 1} ${label}: ${line.trim().slice(0, 100)}`)
      }
    }
  })
}

if (violations.length) {
  for (const v of violations) console.error(`  ✗ ${v}`)
  console.error(`check-os-independence: ${violations.length} violation(s) in ${skillDir}`)
  process.exit(1)
}
console.log(`check-os-independence: ${skillDir} OK`)
