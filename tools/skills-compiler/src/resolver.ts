import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Skill, PluginManifest, SkillLink } from './types.js'

interface ParsedSkill {
  frontmatter: Record<string, unknown>
  body: string
}

function parseFrontmatter(content: string, sourcePath?: string): ParsedSkill {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: content }
  }
  try {
    const parsed = parseYaml(match[1])
    const frontmatter =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    return { frontmatter, body: match[2] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to parse YAML frontmatter${sourcePath ? ` in ${sourcePath}` : ''}: ${message}`,
      { cause: error },
    )
  }
}

function getSource(frontmatter: Record<string, unknown>): string {
  const metadata =
    frontmatter.metadata &&
    typeof frontmatter.metadata === 'object' &&
    !Array.isArray(frontmatter.metadata)
      ? (frontmatter.metadata as Record<string, unknown>)
      : {}
  return String(metadata.source ?? frontmatter.source ?? '')
}

function getDescription(frontmatter: Record<string, unknown>): string {
  return String(frontmatter.description ?? '')
}

function getName(frontmatter: Record<string, unknown>, dir: string): string {
  const raw = frontmatter.name
  const candidate = typeof raw === 'string' ? raw.trim() : ''
  return candidate || path.basename(dir)
}

export function discoverSkills(skillsRoot: string): Map<string, Skill> {
  const byName = new Map<string, Skill>()

  function walk(dir: string, rel: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const skillFile = path.join(dir, 'SKILL.md')
    const isSkill = fs.existsSync(skillFile)

    if (isSkill) {
      const text = fs.readFileSync(skillFile, 'utf8')
      const { frontmatter, body } = parseFrontmatter(text, skillFile)
      const name = getName(frontmatter, dir)
      const description = getDescription(frontmatter)
      const source = getSource(frontmatter)
      const category = rel.split('/').filter((s) => s !== 'dependencies')
      const skill: Skill = {
        name,
        root: rel,
        dir,
        category,
        description,
        source,
        body,
        frontmatter,
        links: [],
      }
      if (byName.has(name)) {
        const existing = byName.get(name)!
        throw new Error(
          `Duplicate skill name '${name}' found at '${rel}' and '${existing.root}'. Skill names must be unique across the entire skills tree.`,
        )
      }
      byName.set(name, skill)
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const childDir = path.join(dir, entry.name)
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      // Inside a skill only recurse into the dependencies directory.
      // Category directories (no SKILL.md) are walked entirely.
      if (isSkill && entry.name !== 'dependencies') continue
      walk(childDir, childRel)
    }
  }

  walk(skillsRoot, '')

  // Second pass: resolve links now that all skills are known.
  // Scan ALL .md files in the skill directory (SKILL.md + references/*.md,
  // etc.) so that cross-skill links in reference files are included in the
  // closure. Without this, only links in SKILL.md count, and skills that
  // declare dependencies via reference files get empty closures.
  for (const skill of byName.values()) {
    const allLinks: SkillLink[] = []
    // Deduplicate by (source file, resolved target) so the same link text
    // in different files is preserved (each file needs its own rewrite),
    // while true duplicates within the same file are collapsed.
    const seen = new Set<string>()
    for (const mdFile of collectMdFiles(skill.dir)) {
      const content = fs.readFileSync(mdFile, 'utf8')
      const fileDir = path.dirname(mdFile)
      const fileLinks = resolveLinksInBody(content, fileDir, skillsRoot, byName)
      for (const link of fileLinks) {
        const key = `${mdFile}\0${link.targetName}\0${link.raw}`
        if (!seen.has(key)) {
          seen.add(key)
          allLinks.push(link)
        }
      }
    }
    skill.links = allLinks
  }

  return byName
}

function collectMdFiles(dir: string): string[] {
  const results: string[] = []
  function walk(d: string) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      // Skip dependencies/ — it is a build-time artifact subtree, not part
      // of the skill's own source. Nested skills there are discovered
      // independently by discoverSkills and should not contribute links to
      // the parent's closure.
      if (entry.isDirectory() && entry.name === 'dependencies') continue
      const fullPath = path.join(d, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.name.toLowerCase().endsWith('.md')) {
        results.push(fullPath)
      }
    }
  }
  walk(dir)
  return results
}

function resolveLinksInBody(
  body: string,
  sourceDir: string,
  skillsRoot: string,
  skillsByName: Map<string, Skill>,
): SkillLink[] {
  const links: SkillLink[] = []
  const seen = new Set<string>()

  // Markdown links to SKILL.md files.
  const mdLinkRegex = /!?\[([^\]]*)\]\(([^)]+)\)/g
  for (const match of body.matchAll(mdLinkRegex)) {
    const [raw, text, url] = match
    if (raw.startsWith('!')) continue // images
    if (url.startsWith('http') || url.startsWith('#')) continue
    const resolved = path.resolve(sourceDir, url.split('?')[0].split('#')[0])
    if (!resolved.toLowerCase().endsWith('.md')) continue
    const skillDir = path.dirname(resolved)
    const skillFile = path.join(skillDir, 'SKILL.md')
    if (!fs.existsSync(skillFile)) continue
    const relToSkills = path.relative(path.resolve(skillsRoot), skillDir).replace(/\\/g, '/')
    // Find skill by directory
    for (const skill of skillsByName.values()) {
      if (skill.root === relToSkills && !seen.has(raw)) {
        seen.add(raw)
        links.push({ text, targetName: skill.name, raw, type: 'file' })
        break
      }
    }
  }

  // Legacy $skill{name} references.
  const skillRefRegex = /\$skill\{([a-z][a-z0-9-]*)\}/g
  for (const match of body.matchAll(skillRefRegex)) {
    const [raw, targetName] = match
    if (!skillsByName.has(targetName)) continue
    if (seen.has(raw)) continue
    seen.add(raw)
    links.push({ text: targetName, targetName, raw, type: 'macro' })
  }

  return links
}

export function readPluginManifest(pluginDir: string): PluginManifest | null {
  const pluginJson = path.join(pluginDir, 'plugin.json')
  if (!fs.existsSync(pluginJson)) return null
  const content = fs.readFileSync(pluginJson, 'utf8')
  return JSON.parse(content) as PluginManifest
}

export function resolveClosure(
  include: string[],
  skillsByName: Map<string, Skill>,
  followMacroLinks = true,
): Skill[] {
  const result: Skill[] = []
  const visited = new Set<string>()

  function visit(name: string) {
    if (visited.has(name)) return
    const skill = skillsByName.get(name)
    if (!skill) return
    visited.add(name)
    for (const link of skill.links) {
      if (link.type === 'macro' && !followMacroLinks) continue
      visit(link.targetName)
    }
    result.push(skill)
  }

  for (const name of include) {
    visit(name)
  }

  return result
}

export function inferProjectName(projectRoot: string, workspaceRoot: string): string {
  return path.relative(path.resolve(workspaceRoot), path.resolve(projectRoot)).replace(/\\/g, '/')
}
