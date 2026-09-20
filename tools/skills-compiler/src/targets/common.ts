import fs from 'node:fs'
import path from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
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

export function emitSkills(
  skills: Skill[],
  outputSkillsDir: string,
  linkFormatter: (link: SkillLink, sourceSkill: Skill) => string,
): void {
  fs.mkdirSync(outputSkillsDir, { recursive: true })
  for (const skill of skills) {
    const targetDir = path.join(outputSkillsDir, skill.name)
    fs.mkdirSync(targetDir, { recursive: true })
    const body = rewriteBody(skill.body, skill.links, linkFormatter, skill)
    const header = '---\n' + stringifyYaml(skill.frontmatter, { lineWidth: 0 }) + '---\n'
    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), header + body, 'utf8')
  }
}
