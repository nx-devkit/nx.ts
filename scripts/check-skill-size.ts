#!/usr/bin/env tsx
/**
 * check-skill-size — enforce skill size budgets.
 *
 * Usage: tsx scripts/check-skill-size.ts --skill <dir>
 *
 * Budgets (progressive-disclosure convention):
 *  - SKILL.md body must be <= 500 lines and <= 50 KiB
 *  - the whole skill directory must be <= 1 MiB
 *
 * Exit 0 within budget, 1 on violation.
 */
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const MAX_LINES = 500,
  MAX_SKILL_MD_BYTES = 50 * 1024,
  MAX_DIR_BYTES = 1024 * 1024

const skillArg = process.argv.indexOf('--skill')
const skillDir = skillArg !== -1 ? process.argv[skillArg + 1] : undefined
if (!skillDir) {
  console.error('Usage: check-skill-size.ts --skill <dir>')
  process.exit(1)
}

const root = resolve(skillDir),
  errors: string[] = [],
  skillMd = join(root, 'SKILL.md')
try {
  const content = readFileSync(skillMd, 'utf8')
  const lines =
    content === '' ? 0 : content.split(/\r?\n/).length - (content.endsWith('\n') ? 1 : 0)
  const bytes = Buffer.byteLength(content)
  if (lines > MAX_LINES) errors.push(`SKILL.md has ${lines} lines (limit ${MAX_LINES})`)
  if (bytes > MAX_SKILL_MD_BYTES) {
    errors.push(`SKILL.md is ${bytes} bytes (limit ${MAX_SKILL_MD_BYTES})`)
  }
} catch {
  errors.push('SKILL.md not found')
}

let dirBytes = 0
// Canonical root — a `--skill` arg that is itself a symlink must still
// compare correctly against realpath() results. A missing or unreadable
// directory is reported as an error, not a stack trace.
let realRoot = ''

function walk(dir: string): void {
  // eslint-disable-next-line node/no-sync -- sync CLI traversal
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    const st = lstatSync(full)
    if (st.isSymbolicLink()) {
      // Never follow links — verify the target stays inside the skill and
      // count only the link itself.
      const rel = full.slice(root.length + 1)
      try {
        const real = realpathSync(full)
        const relToRoot = relative(realRoot, real)
        if (relToRoot === '..' || relToRoot.startsWith(`..${sep}`) || isAbsolute(relToRoot)) {
          errors.push(`${rel}: symlink escapes skill directory -> ${real}`)
        }
      } catch {
        errors.push(`${rel}: dangling symlink`)
      }
      dirBytes += st.size
      continue
    }
    if (st.isDirectory()) walk(full)
    else dirBytes += st.size
  }
}
try {
  realRoot = realpathSync(root)
  walk(root)
} catch {
  errors.push(`skill directory does not exist or is not readable: ${skillDir}`)
}
if (dirBytes > MAX_DIR_BYTES) {
  errors.push(`skill directory is ${dirBytes} bytes (limit ${MAX_DIR_BYTES})`)
}

if (errors.length) {
  for (const e of errors) console.error(`  ✗ ${e}`)
  console.error(`check-skill-size: ${errors.length} error(s) in ${skillDir}`)
  process.exit(1)
}
console.log(`check-skill-size: ${skillDir} OK`)
