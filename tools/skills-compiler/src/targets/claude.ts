import fs from 'node:fs'
import path from 'node:path'
import { emitPluginManifest, emitSkills } from './common.js'
import type { CompilerOptions, PluginDependency, Skill } from '../types.js'

export function buildClaude(
  options: CompilerOptions,
  skills: Skill[],
  projectName: string,
  description?: string,
  dependencies?: PluginDependency[],
): void {
  fs.mkdirSync(options.outDir, { recursive: true })
  // The closure is dependency-first, so skills[0] is not necessarily the
  // requested skill — fall back to the primary skill's description.
  const pluginJson: Record<string, unknown> = {
    name: projectName,
    description: description ?? skills.find((s) => s.name === projectName)?.description ?? '',
    version: '1.0.0',
    skills: './skills/',
  }
  if (dependencies && dependencies.length > 0) {
    pluginJson.dependencies = dependencies
  }
  emitPluginManifest(path.join(options.outDir, '.claude-plugin'), pluginJson)
  emitSkills(skills, path.join(options.outDir, 'skills'), (link) => `$skill{${link.targetName}}`)
}
