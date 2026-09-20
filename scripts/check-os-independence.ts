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
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const skillArg = process.argv.indexOf('--skill')
const skillDir = skillArg >= 0 ? process.argv[skillArg + 1] : undefined
if (!skillDir) {
  console.error('Usage: check-os-independence.ts --skill <dir>')
  process.exit(1)
}

const root = resolve(skillDir)
const TEXT_EXT = new Set(['.md', '.ts', '.js', '.mjs', '.sh', '.yaml', '.yml', '.json', '.txt'])

const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\/Users\/\S+/, label: 'macOS user path (/Users/…)' },
  { re: /\/home\/[a-zA-Z0-9._-]+\//, label: 'Linux user path (/home/<user>/…)' },
  { re: /\b[A-Za-z]:\\[\w\\.-]+/, label: 'Windows path (C:\\…)' },
  { re: /\bcmd\.exe\b/i, label: 'cmd.exe invocation' },
  { re: /\bpowershell\b/i, label: 'powershell invocation' },
  { re: /\bwinget\b/i, label: 'winget (Windows-only)' },
  { re: /\bbrew (install|upgrade)\b/, label: 'brew (macOS-only)' },
]

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) yield* walk(full)
    else if (TEXT_EXT.has(full.slice(full.lastIndexOf('.')))) yield full
  }
}

const violations: string[] = []
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
