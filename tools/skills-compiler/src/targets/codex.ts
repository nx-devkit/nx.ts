import fs from 'node:fs'
import path from 'node:path'
import { emitPluginManifest, emitSkills } from './common.js'
import type { CompilerOptions, Skill } from '../types.js'

export function buildCodex(
  options: CompilerOptions,
  skills: Skill[],
  projectName: string,
  description?: string,
): void {
  fs.mkdirSync(options.outDir, { recursive: true })
  const pluginJson = {
    name: projectName,
    version: '1.0.0',
    description: description ?? skills.find((s) => s.name === projectName)?.description ?? '',
    skills: './skills/',
  }
  emitPluginManifest(path.join(options.outDir, '.codex-plugin'), pluginJson)
  emitSkills(skills, path.join(options.outDir, 'skills'), (link) => `$skill{${link.targetName}}`)
}
