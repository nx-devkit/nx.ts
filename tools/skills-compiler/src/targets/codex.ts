import fs from 'node:fs'
import path from 'node:path'
import { emitSkills } from './common.js'
import type { CompilerOptions, Skill } from '../types.js'

export function buildCodex(
  options: CompilerOptions,
  skills: Skill[],
  projectName: string,
  description?: string,
): void {
  fs.mkdirSync(options.outDir, { recursive: true })
  const pluginDir = path.join(options.outDir, '.codex-plugin')
  fs.mkdirSync(pluginDir, { recursive: true })
  const pluginJson = {
    name: projectName,
    version: '1.0.0',
    description: description ?? skills[0]?.description ?? '',
    skills: './skills/',
  }
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    `${JSON.stringify(pluginJson, null, 2)}\n`,
    'utf8',
  )
  emitSkills(skills, path.join(options.outDir, 'skills'), (link) => `$skill{${link.targetName}}`)
}
