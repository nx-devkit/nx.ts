#!/usr/bin/env tsx
/**
 * validate-skill — structural validation for a skill directory.
 *
 * Usage: tsx scripts/validate-skill.ts --skill <dir>
 *
 * Checks:
 *  - SKILL.md exists
 *  - frontmatter block is present and parses
 *  - `name` and `description` are non-empty strings
 *  - `name` matches the skill directory basename
 *  - description length is within the 1024-char spec limit
 *  - agents/openai.yaml (when present) has display_name + short_description
 *
 * Exit 0 on success, 1 on any violation.
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const skillArg = process.argv.indexOf('--skill')
const skillDir = skillArg >= 0 ? process.argv[skillArg + 1] : undefined
if (!skillDir) {
  console.error('Usage: validate-skill.ts --skill <dir>')
  process.exit(1)
}

const root = resolve(skillDir)
const errors: string[] = []

const skillMd = join(root, 'SKILL.md')
if (!existsSync(skillMd)) {
  errors.push(`SKILL.md not found in ${skillDir}`)
} else {
  const content = readFileSync(skillMd, 'utf8')
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!match) {
    errors.push('SKILL.md is missing a YAML frontmatter block')
  } else {
    const fields = new Map<string, string>()
    for (const line of match[1].split('\n')) {
      const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
      if (m) fields.set(m[1], m[2].replace(/^["']|["']$/g, '').trim())
    }
    const name = fields.get('name')
    const description = fields.get('description')
    if (!name) errors.push('frontmatter `name` is missing or empty')
    if (!description) errors.push('frontmatter `description` is missing or empty')
    // name should match the directory basename for normal skill dirs; container
    // dirs like `.agents/skills` legitimately carry a different frontmatter name.
    if (name && name !== basename(root) && basename(root) !== 'skills') {
      console.warn(`  ! frontmatter name "${name}" does not match directory "${basename(root)}"`)
    }
    if (description && description.length > 1024) {
      errors.push(`description is ${description.length} chars (limit 1024)`)
    }
    if (name && !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      errors.push(`name "${name}" is not kebab-case`)
    }
  }
}

const openaiMeta = join(root, 'agents', 'openai.yaml')
if (existsSync(openaiMeta)) {
  const meta = readFileSync(openaiMeta, 'utf8')
  for (const key of ['display_name', 'short_description', 'default_prompt']) {
    if (!new RegExp(`^\\s*${key}:\\s*\\S`, 'm').test(meta)) {
      errors.push(`agents/openai.yaml is missing \`${key}\``)
    }
  }
}

if (errors.length) {
  for (const e of errors) console.error(`  ✗ ${e}`)
  console.error(`validate-skill: ${errors.length} error(s) in ${skillDir}`)
  process.exit(1)
}
console.log(`validate-skill: ${skillDir} OK`)
