/* eslint-disable one-var, capitalized-comments, node/no-sync -- sync executor by design */
import { spawnSync } from 'node:child_process'

export interface NxReleasePlanOptions {
  /** Base branch to compare against. Default: "main". */
  base?: string
  /** Head branch to compare. Default: current HEAD. */
  head?: string
  /** If true, include dependents of changed projects. Default: true. */
  includeDependents?: boolean
  /** If true, output as JSON. Default: false. */
  json?: boolean
}

export interface NxReleasePlanResult {
  success: boolean
  projects: string[]
  affected: string[]
  dependents: string[]
  skipped: string[]
}

function exec(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number } = {},
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    timeout: opts.timeout ?? 120_000,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (result.signal === 'SIGTERM') {
    throw new Error(`Command timed out: ${cmd} ${args.join(' ')}`)
  }
  if (result.error) {
    throw new Error(`Command failed to spawn: ${cmd} ${args.join(' ')} — ${result.error.message}`)
  }
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  }
}

function _execOrThrow(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number } = {},
): { stdout: string; stderr: string } {
  const result = exec(cmd, args, opts)
  if (!result.ok) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${result.stderr}`)
  }
  return { stdout: result.stdout, stderr: result.stderr }
}

export interface NxReleasePlanOptions {
  base?: string
  head?: string
  includeDependents?: boolean
  json?: boolean
}

export interface NxReleasePlanResult {
  success: boolean
  projects: string[]
  affected: string[]
  dependents: string[]
  skipped: string[]
}

export async function planExecutor(
  options: NxReleasePlanOptions = {},
): Promise<NxReleasePlanResult> {
  const result: NxReleasePlanResult = {
    success: false,
    projects: [],
    affected: [],
    dependents: [],
    skipped: [],
  }

  const base = options.base ?? 'main'
  const head = options.head ?? 'HEAD'
  const includeDependents = options.includeDependents ?? true

  // Get all projects in the workspace
  const projectsResult = exec('npx', ['nx', 'show', 'projects', '--json'])
  if (!projectsResult.ok) {
    throw new Error(`Failed to get projects: ${projectsResult.stderr}`)
  }
  let allProjects: string[] = []
  try {
    allProjects = JSON.parse(projectsResult.stdout)
  } catch {
    result.skipped.push('failed to parse projects list')
    result.success = false
    return result
  }

  // Get affected projects using nx affected
  const affectedResult = exec('npx', ['nx', 'affected', '--base', base, '--head', head, '--json'])
  if (!affectedResult.ok) {
    throw new Error(`Failed to get affected projects: ${affectedResult.stderr}`)
  }
  let affected: string[] = []
  try {
    affected = JSON.parse(affectedResult.stdout).projects || []
  } catch {
    result.skipped.push('failed to parse affected projects')
    result.success = false
    return result
  }

  // Get dependents of affected projects
  let dependents: string[] = []
  if (includeDependents && affected.length > 0) {
    for (const project of affected) {
      const depsResult = exec('npx', [
        'nx',
        'show',
        'projects',
        '--dependents-of',
        project,
        '--json',
      ])
      if (depsResult.ok) {
        try {
          const deps = JSON.parse(depsResult.stdout)
          dependents.push(...deps)
        } catch {}
      }
    }
    // Deduplicate
    dependents = [...new Set(dependents)]
  }

  // Candidate set = affected + dependents
  const candidates = [...new Set([...affected, ...dependents])]

  result.projects = allProjects
  result.affected = affected
  result.dependents = dependents

  if (options.json) {
    console.log(
      JSON.stringify({ projects: allProjects, affected, dependents, candidates }, null, 2),
    )
  }

  result.success = true
  return result
}

export default planExecutor
