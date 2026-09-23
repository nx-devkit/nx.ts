import fs from 'node:fs'
import path from 'node:path'
import { linksForFile, rewriteBody } from './common.js'
import type { CompilerOptions, Skill, SkillLink } from '../types.js'

export function buildObsidian(options: CompilerOptions, skills: Skill[]): void {
  const skillsByName = new Map(skills.map((s) => [s.name, s]))
  fs.mkdirSync(options.outDir, { recursive: true })

  for (const skill of skills) {
    const targetDir = path.join(options.outDir, skill.name)
    fs.mkdirSync(targetDir, { recursive: true })
    const body = rewriteBody(
      skill.body,
      linksForFile(skill, 'SKILL.md'),
      (link: SkillLink) => {
        const target = skillsByName.get(link.targetName)
        if (!target) return link.raw
        const rel = path.relative(skill.name, target.name).replace(/\\/g, '/')
        return `[${link.text}](${rel ? `${rel}/` : ''}${target.name}.md)`
      },
      skill,
    )
    fs.writeFileSync(path.join(targetDir, `${skill.name}.md`), body, 'utf8')
  }
}
