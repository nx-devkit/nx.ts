import path from 'node:path'
import { discoverSkills, readPluginManifest, resolveClosure } from './resolver.js'
import type { CompilerOptions, PluginDependency, Skill } from './types.js'
import { buildClaude } from './targets/claude.js'
import { buildCodex } from './targets/codex.js'
import { buildAgents } from './targets/agents.js'
import { buildObsidian } from './targets/obsidian.js'
import { buildSkillsSh } from './targets/skills-sh.js'

function findSkillByDir(skills: Map<string, Skill>, dir: string): Skill | undefined {
  const resolved = path.resolve(dir)
  for (const skill of skills.values()) {
    if (path.resolve(skill.dir) === resolved) return skill
  }
  return undefined
}

function dependencyName(dep: PluginDependency): string {
  return typeof dep === 'string' ? dep : dep.name
}

function mergeDependencies(
  manifestDeps: PluginDependency[],
  extraNames: string[],
): PluginDependency[] {
  const seen = new Set(manifestDeps.map(dependencyName))
  const result = [...manifestDeps]
  for (const name of extraNames) {
    if (!seen.has(name)) {
      seen.add(name)
      result.push(name)
    }
  }
  return result
}

export function build(options: CompilerOptions): void {
  const skillsByName = discoverSkills(options.skillsRoot)
  for (const skill of skillsByName.values()) {
    const extra = options.skillMetadata?.[skill.name]?.frontmatter
    if (extra) {
      const extraMeta =
        extra.metadata && typeof extra.metadata === 'object' && !Array.isArray(extra.metadata)
          ? (extra.metadata as Record<string, unknown>)
          : {}
      const currentMeta =
        skill.frontmatter.metadata &&
        typeof skill.frontmatter.metadata === 'object' &&
        !Array.isArray(skill.frontmatter.metadata)
          ? (skill.frontmatter.metadata as Record<string, unknown>)
          : {}
      const extraTop = Object.fromEntries(
        Object.entries(extra).filter(
          ([k]) => k !== 'metadata' && k !== 'name' && k !== 'description',
        ),
      )
      skill.frontmatter = {
        ...skill.frontmatter,
        ...extraTop,
        metadata: { ...currentMeta, ...extraMeta },
      }
    }
  }
  const pluginManifest = readPluginManifest(options.projectRoot)

  let include: string[]
  let projectName: string
  let description: string | undefined

  if (pluginManifest) {
    include = pluginManifest.include
    projectName = pluginManifest.name
    description = pluginManifest.description
  } else {
    const sourceSkill = findSkillByDir(skillsByName, options.projectRoot)
    if (!sourceSkill) {
      throw new Error(`Cannot find skill for project ${options.projectRoot}`)
    }
    include = [sourceSkill.name]
    projectName = sourceSkill.name
    description = sourceSkill.description
  }

  const closure = resolveClosure(include, skillsByName, true)
  if (closure.length === 0) {
    throw new Error(`No skills resolved for project ${options.projectRoot}`)
  }

  const useExternal = options.dependencies === 'external'
  if (useExternal && options.target !== 'claude') {
    throw new Error(
      `External dependencies are only supported for Claude plugins, not for target '${options.target}'`,
    )
  }
  const inlineDependencies = !useExternal
  const skillsToEmit = inlineDependencies
    ? closure
    : closure.filter((s) => include.includes(s.name))

  const manifestDeps: PluginDependency[] = pluginManifest?.dependencies ?? []
  const externalDepNames: string[] = []
  if (!inlineDependencies) {
    const includedSet = new Set(include)
    for (const skill of closure) {
      if (!includedSet.has(skill.name)) externalDepNames.push(skill.name)
    }
  }
  const pluginDependencies = mergeDependencies(manifestDeps, externalDepNames)

  switch (options.target) {
    case 'claude':
      buildClaude(options, skillsToEmit, projectName, description, pluginDependencies)
      break
    case 'codex':
      buildCodex(options, skillsToEmit, projectName, description)
      break
    case 'agents':
      buildAgents(options, skillsToEmit)
      break
    case 'obsidian':
      buildObsidian(options, skillsToEmit)
      break
    case 'skills-sh':
      buildSkillsSh(options, skillsToEmit, projectName)
      break
    default:
      throw new Error(`Unknown target: ${options.target}`)
  }
}
