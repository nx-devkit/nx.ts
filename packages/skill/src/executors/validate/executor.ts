import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parse } from 'yaml'

export interface ValidateExecutorOptions {
  /** Relative path (from workspace root) to the skill directory. Required. */
  path: string
}

export interface ValidateExecutorResult {
  success: boolean
}

/**
 * Validate executor for `@nx-devkit/skill:validate`.
 *
 * Structural validation of a skill directory:
 *  - SKILL.md exists
 *  - frontmatter block is present and parses
 *  - `name` and `description` are non-empty strings
 *  - `name` matches the skill directory basename
 *  - description length is within the 1024-char spec limit
 *  - agents/openai.yaml (when present) has display_name + short_description
 */
export async function validateExecutor(
  options: ValidateExecutorOptions,
  context?: { root?: string },
): Promise<ValidateExecutorResult> {
  const workspaceRoot = context?.root ?? process.cwd()
  const root = resolve(workspaceRoot, options.path)
  const errors: string[] = []

  const skillMd = join(root, 'SKILL.md')
  if (!existsSync(skillMd)) {
    errors.push(`SKILL.md not found in ${options.path}`)
  } else {
    const content = readFileSync(skillMd, 'utf8')
    // Extract the frontmatter block between --- fences (no regex needed).
    const lines = content.split('\n')
    const fmEnd =
      lines[0]?.trim() === '---' ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') : -1
    if (fmEnd <= 0) {
      errors.push('SKILL.md is missing a YAML frontmatter block')
    } else {
      // Parse with a real YAML parser so scalar types are enforced — a
      // line-regex parser would accept `name: 123` as the string "123".
      let fm: unknown
      try {
        fm = parse(lines.slice(1, fmEnd).join('\n'))
      } catch (err) {
        errors.push(`frontmatter does not parse as YAML: ${(err as Error).message}`)
        fm = undefined
      }
      if (fm !== undefined && (typeof fm !== 'object' || fm === null || Array.isArray(fm))) {
        errors.push('frontmatter must be a YAML mapping')
      } else if (fm !== undefined) {
        const fields = fm as Record<string, unknown>
        const name = fields.name
        const description = fields.description
        if (typeof name !== 'string' || !name.trim()) {
          errors.push('frontmatter `name` is missing or not a non-empty string')
        }
        if (typeof description !== 'string' || !description.trim()) {
          errors.push('frontmatter `description` is missing or not a non-empty string')
        }
        // Name must match the directory basename for normal skill dirs;
        // container dirs like `.agents/skills` legitimately differ.
        if (typeof name === 'string' && name !== basename(root) && basename(root) !== 'skills') {
          errors.push(`frontmatter name "${name}" does not match directory "${basename(root)}"`)
        }
        if (typeof description === 'string' && description.length > 1024) {
          errors.push(`description is ${description.length} chars (limit 1024)`)
        }
        if (typeof name === 'string' && !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
          errors.push(`name "${name}" is not kebab-case`)
        }
      }
    }
  }

  const openaiMeta = join(root, 'agents', 'openai.yaml')
  if (existsSync(openaiMeta)) {
    let meta: unknown
    try {
      meta = parse(readFileSync(openaiMeta, 'utf8'))
    } catch (err) {
      errors.push(`agents/openai.yaml does not parse as YAML: ${(err as Error).message}`)
      meta = undefined
    }
    if (meta !== undefined && (typeof meta !== 'object' || meta === null || Array.isArray(meta))) {
      errors.push('agents/openai.yaml must be a YAML mapping')
    } else if (meta !== undefined) {
      const fields = meta as Record<string, unknown>
      for (const key of ['display_name', 'short_description', 'default_prompt']) {
        if (typeof fields[key] !== 'string' || !(fields[key] as string).trim()) {
          errors.push(`agents/openai.yaml is missing \`${key}\` or it is not a non-empty string`)
        }
      }
    }
  }

  if (errors.length) {
    for (const e of errors) console.error(`  ✗ ${e}`)
    console.error(`validate: ${errors.length} error(s) in ${options.path}`)
    return { success: false }
  }
  console.log(`validate: ${options.path} OK`)
  return { success: true }
}

export default validateExecutor
