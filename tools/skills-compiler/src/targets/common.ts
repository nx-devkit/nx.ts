import fs from 'node:fs'
import path from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { collectMdFiles } from '../resolver.js'
import type { Skill, SkillLink } from '../types.js'

export function rewriteBody(
  body: string,
  links: SkillLink[],
  replacer: (link: SkillLink, sourceSkill: Skill) => string,
  sourceSkill: Skill,
): string {
  let result = body
  for (const link of links) {
    result = result.split(link.raw).join(replacer(link, sourceSkill))
  }
  return result
}

export function copySkillDirectory(src: string, dest: string): void {
  // Remove stale output first so deleted/renamed source files do not linger
  // in repeated builds.
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

export function emitPluginManifest(pluginDir: string, manifest: Record<string, unknown>): void {
  fs.mkdirSync(pluginDir, { recursive: true })
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )
}

export function linksForFile(skill: Skill, relFile: string): SkillLink[] {
  return skill.links.filter((l) => l.sourceFile === relFile || l.sourceFile === undefined)
}

export function emitSkills(
  skills: Skill[],
  outputSkillsDir: string,
  linkFormatter: (link: SkillLink, sourceSkill: Skill) => string,
): void {
  // Clear stale output so a removed dependency does not linger in the bundle.
  fs.rmSync(outputSkillsDir, { recursive: true, force: true })
  fs.mkdirSync(outputSkillsDir, { recursive: true })
  for (const skill of skills) {
    const targetDir = path.join(outputSkillsDir, skill.name)
    // Copy the whole skill tree — supporting files (references/, scripts/)
    // are part of the installed skill, not just SKILL.md.
    copySkillDirectory(skill.dir, targetDir)
    // Rewrite links in every other bundled markdown file with the links that
    // were collected from that same source file.
    for (const mdFile of collectMdFiles(targetDir)) {
      const relFile = path.relative(targetDir, mdFile).replace(/\\/g, '/')
      if (relFile === 'SKILL.md') continue
      const fileLinks = linksForFile(skill, relFile)
      if (fileLinks.length === 0) continue
      const content = fs.readFileSync(mdFile, 'utf8')
      fs.rmSync(mdFile, { force: true }) // unlink a copied symlink before writing
      fs.writeFileSync(mdFile, rewriteBody(content, fileLinks, linkFormatter, skill), 'utf8')
    }
    // SKILL.md is regenerated with normalized frontmatter. Unlink first — a
    // symlinked source SKILL.md would otherwise be written through the link
    // and corrupt the source tree.
    const skillMdPath = path.join(targetDir, 'SKILL.md')
    fs.rmSync(skillMdPath, { force: true })
    const body = rewriteBody(skill.body, linksForFile(skill, 'SKILL.md'), linkFormatter, skill)
    const header = '---\n' + stringifyYaml(skill.frontmatter, { lineWidth: 0 }) + '---\n'
    fs.writeFileSync(skillMdPath, header + body, 'utf8')
  }
}
