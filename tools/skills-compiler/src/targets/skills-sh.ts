import fs from 'node:fs'
import path from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { rewriteBody } from './common.js'
import type { CompilerOptions, Skill, SkillLink } from '../types.js'

const DEFAULT_CANONICAL_SOURCE = 'theplenkov-ai/skills'

function copySkillDirectory(src: string, dest: string): void {
  // Remove stale output first so deleted/renamed source files do not linger
  // In repeated builds.
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    // Dependencies/ is a build-time artifact from earlier formats; do not publish it.
    if (entry.name === 'dependencies') continue
    const srcPath = path.join(src, entry.name),
      destPath = path.join(dest, entry.name)
    if (entry.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(srcPath)
      let type: 'dir' | 'file' = 'file'
      try {
        type = fs.statSync(srcPath).isDirectory() ? 'dir' : 'file'
      } catch {
        // Dangling symlink — nothing to resolve; keep it as a file-type link.
      }
      fs.symlinkSync(linkTarget, destPath, type)
    } else if (entry.isDirectory()) {
      copySkillDirectory(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

function normalizeRepoShorthand(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let repoShorthand = value.trim()
  if (repoShorthand === '') return null

  // Accept `https://github.com/owner/repo.git` and `git@github.com:owner/repo.git`.
  const httpsMatch = /^https:\/\/github\.com\/(.+)$/i.exec(repoShorthand),
    gitMatch = /^git@github\.com:(.+)$/i.exec(repoShorthand)
  if (httpsMatch) {
    repoShorthand = httpsMatch[1]
  } else if (gitMatch) {
    repoShorthand = gitMatch[1]
  } else if (repoShorthand.includes('://') || repoShorthand.startsWith('git@')) {
    // Looks like a URL/SCP form but did not match the expected patterns.
    return null
  }

  // Drop query/fragment and a trailing `.git` (with optional trailing slash).
  repoShorthand = repoShorthand.split(/[?#]/, 1)[0]
  repoShorthand = repoShorthand.replace(/\.git\/?$/i, '')

  const parts = repoShorthand.split('/').filter((p) => p !== '')
  if (parts.length !== 2) return null
  const [owner, repo] = parts
  if (!owner || !repo) return null
  if (/\s/.test(owner) || /\s/.test(repo)) return null
  return `${owner}/${repo}`
}

export function normalizeFrontmatter(
  input: Record<string, unknown>,
  publicSource?: string,
): string {
  const safeInput =
      input && typeof input === 'object' && !Array.isArray(input)
        ? input
        : ({} as Record<string, unknown>),
    output: Record<string, unknown> = { ...safeInput },
    sourceMeta =
      safeInput.metadata &&
      typeof safeInput.metadata === 'object' &&
      !Array.isArray(safeInput.metadata)
        ? (safeInput.metadata as Record<string, unknown>)
        : {},
    // Preserve all metadata from the source, then backfill legacy top-level keys
    // so both pre- and post-migration layouts produce the same published output.
    metadata: Record<string, unknown> = { ...sourceMeta }
  for (const key of Object.keys(safeInput)) {
    if (key === 'metadata' || key === 'name' || key === 'description') continue
    if (metadata[key] === undefined) metadata[key] = safeInput[key]
  }

  const rawSource = String(metadata.source ?? safeInput.source ?? ''),
    canonicalSource = normalizeRepoShorthand(rawSource) ?? 'theplenkov-ai/skills'

  let targetSource = canonicalSource
  if (publicSource !== undefined) {
    const normalizedPublic = normalizeRepoShorthand(publicSource)
    if (!normalizedPublic) {
      throw new Error(
        `publicSource must be a non-empty owner/repo shorthand, got: ${JSON.stringify(publicSource)}`,
      )
    }
    // Only override the public mirror for skills owned by this repo.
    // Forks and external skills keep their declared canonical source.
    if (canonicalSource.toLowerCase() === DEFAULT_CANONICAL_SOURCE) {
      targetSource = normalizedPublic
    }
  }

  metadata.source = targetSource
  output.metadata = metadata
  output.source = targetSource
  return stringifyYaml(output, { lineWidth: 0 })
}

function relativeSkillPath(
  fromDir: string,
  targetName: string,
  projectName: string,
  outDir: string,
  byName: Map<string, Skill>,
): string | null {
  if (!byName.has(targetName)) return null
  // Dependency skills are emitted as README.md (not SKILL.md) so that
  // Skills.sh indexer sees exactly one SKILL.md per snapshot — the primary.
  const fileName = targetName === projectName ? 'SKILL.md' : 'README.md',
    targetPath =
      targetName === projectName
        ? path.join(outDir, 'SKILL.md')
        : path.join(outDir, 'references', targetName, fileName)
  return path.relative(fromDir, targetPath).replace(/\\/g, '/')
}

function walkMdFiles(dir: string, callback: (filePath: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkMdFiles(fullPath, callback)
    } else if (entry.name.toLowerCase().endsWith('.md')) {
      callback(fullPath)
    }
  }
}

function rewriteFileMacros(
  filePath: string,
  projectName: string,
  outDir: string,
  byName: Map<string, Skill>,
): void {
  const content = fs.readFileSync(filePath, 'utf8'),
    fileDir = path.dirname(filePath),
    names = [...byName.keys()].sort((a, b) => b.length - a.length)
  if (names.length === 0) return

  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)),
    regex = new RegExp(`\\$skill\\{(${escaped.join('|')})\\}`, 'g')

  let changed = false
  const result = content.replace(regex, (match, name: string) => {
    const rel = relativeSkillPath(fileDir, name, projectName, outDir, byName)
    if (!rel) return match
    changed = true
    return `[${name}](${rel})`
  })

  if (changed) {
    fs.writeFileSync(filePath, result, 'utf8')
  }
}

function rewriteFileLinks(
  filePath: string,
  sourceDir: string,
  skillsRoot: string,
  projectName: string,
  outDir: string,
  byName: Map<string, Skill>,
): void {
  const content = fs.readFileSync(filePath, 'utf8'),
    fileDir = path.dirname(filePath),
    // Match markdown links to .md files (excluding images).
    mdLinkRegex = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g
  let changed = false
  const result = content.replace(mdLinkRegex, (raw, text, url) => {
    // Optional link titles (`(path "title")`) — split off and preserve.
    const titleMatch = /^(\S+)(\s.*)?$/.exec(url.trim()),
      urlPart = titleMatch?.[1] ?? url,
      titleRest = titleMatch?.[2] ?? ''
    if (urlPart.startsWith('http') || urlPart.startsWith('#')) return raw
    const cleanUrl = urlPart.split('?')[0].split('#')[0],
      suffix = urlPart.slice(cleanUrl.length)
    if (!cleanUrl.toLowerCase().endsWith('.md')) return raw

    // Resolve the link relative to the SOURCE file's directory (not the
    // Published copy) to find which skill it points at.
    const resolved = path.resolve(sourceDir, cleanUrl)
    if (!resolved.toLowerCase().endsWith('skill.md')) return raw
    const skillDir = path.dirname(resolved),
      relToSkills = path.relative(path.resolve(skillsRoot), skillDir).replace(/\\/g, '/')

    // Find the target skill by directory.
    let targetName: string | null = null
    for (const skill of byName.values()) {
      if (skill.root === relToSkills) {
        targetName = skill.name
        break
      }
    }
    if (!targetName) return raw

    // Compute the correct relative path in the published bundle.
    const rel = relativeSkillPath(fileDir, targetName, projectName, outDir, byName)
    if (!rel) return raw
    changed = true
    return `[${text}](${rel}${suffix}${titleRest})`
  })

  if (changed) {
    fs.writeFileSync(filePath, result, 'utf8')
  }
}

function emitSkill(
  skill: Skill,
  destDir: string,
  isPrimary: boolean,
  options: CompilerOptions,
  projectName: string,
  byName: Map<string, Skill>,
): void {
  copySkillDirectory(skill.dir, destDir)

  const linkFormatter = (link: SkillLink, _source: Skill) => {
      const target = byName.get(link.targetName)
      if (!target) return link.raw
      if (isPrimary) {
        if (target.name === projectName) {
          return `[${link.text}](SKILL.md)`
        }
        return `[${link.text}](references/${target.name}/README.md)`
      }
      if (target.name === projectName) {
        return `[${link.text}](../../SKILL.md)`
      }
      return `[${link.text}](../${target.name}/README.md)`
    },
    header = `---\n${normalizeFrontmatter(skill.frontmatter, options.publicSource)}---\n`,
    body = rewriteBody(skill.body, skill.links, linkFormatter, skill),
    // Primary skill: write SKILL.md (the one skills.sh indexes).
    // Dependency skills: write README.md and remove SKILL.md so the snapshot
    // contains exactly one SKILL.md — the primary — which skills.sh expects.
    // If the source skill already has a README.md, preserve it as README.source.md
    // before writing the generated dependency README.
    primaryPath = path.join(destDir, 'SKILL.md'),
    readmePath = path.join(destDir, 'README.md')
  if (isPrimary) {
    fs.writeFileSync(primaryPath, header + body, 'utf8')
  } else {
    fs.rmSync(primaryPath, { force: true })
    if (fs.existsSync(readmePath)) {
      fs.renameSync(readmePath, path.join(destDir, 'README.source.md'))
    }
    fs.writeFileSync(readmePath, header + body, 'utf8')
  }
  const skillMdPath = isPrimary ? primaryPath : readmePath

  // Rewrite $skill{} macros and file links to SKILL.md in bundled reference
  // Files so they remain resolvable when the skill is installed on its own.
  walkMdFiles(destDir, (filePath) => {
    if (filePath === skillMdPath) return
    const relPath = path.relative(destDir, filePath),
      sourceFilePath = path.join(skill.dir, relPath),
      sourceFileDir = path.dirname(sourceFilePath)
    rewriteFileMacros(filePath, projectName, options.outDir, byName)
    rewriteFileLinks(
      filePath,
      sourceFileDir,
      options.skillsRoot,
      projectName,
      options.outDir,
      byName,
    )
  })
}

export function buildSkillsSh(
  options: CompilerOptions,
  skills: Skill[],
  projectName: string,
): void {
  const byName = new Map(skills.map((s) => [s.name, s])),
    primary = byName.get(projectName)
  if (!primary) {
    throw new Error(`Primary skill '${projectName}' not found for skills-sh build`)
  }

  fs.mkdirSync(options.outDir, { recursive: true })
  const refsDir = path.join(options.outDir, 'references')

  for (const skill of skills) {
    if (skill.name === projectName) continue
    emitSkill(skill, path.join(refsDir, skill.name), false, options, projectName, byName)
  }
  emitSkill(primary, options.outDir, true, options, projectName, byName)
}
