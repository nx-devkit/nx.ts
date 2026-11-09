import fs from 'node:fs'
import path from 'node:path'
import type { CompilerOptions, Skill } from '../types.js'
import { emitSkills } from './common.js'

export function buildAgents(options: CompilerOptions, skills: Skill[]): void {
  const agentsRoot = path.join(options.outDir, '.agents', 'skills')
  fs.mkdirSync(agentsRoot, { recursive: true })
  emitSkills(skills, agentsRoot, (link) => `$skill{${link.targetName}}`)
}
