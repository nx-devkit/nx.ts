import fs from 'node:fs'
import path from 'node:path'
import { emitSkills } from './common.js'
import type { CompilerOptions, PluginDependency, Skill } from '../types.js'

export function buildClaude(
  options: CompilerOptions,
  skills: Skill[],
  projectName: string,
  description?: string,
  dependencies?: PluginDependency[],
): void {
  fs.mkdirSync(options.outDir, { recursive: true })
  const pluginDir = path.join(options.outDir, '.claude-plugin')
  fs.mkdirSync(pluginDir, { recursive: true })
  const pluginJson: Record<string, unknown> = {
    name: projectName,
    description: description ?? skills[0]?.description ?? '',
    version: '1.0.0',
    skills: './skills/',
  }
  if (dependencies && dependencies.length > 0) {
    pluginJson.dependencies = dependencies
  }
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    `${JSON.stringify(pluginJson, null, 2)}\n`,
    'utf8',
  )
  emitSkills(skills, path.join(options.outDir, 'skills'), (link) => `$skill{${link.targetName}}`)
}
