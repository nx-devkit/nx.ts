import { globSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  createProjectGraphAsync,
  logger,
  type ExecutorContext,
  type ProjectGraph,
} from '@nx/devkit'
import { isVerbose, logDebug } from '@nx-devkit/internal'
import { collectImports } from '../../imports.ts'
import { isAllowed } from '../../constraints.ts'
import { loadTsPaths, resolveImport } from '../../resolve.ts'
import { projectIndex, projectTags } from '../../tags.ts'
import type { DepConstraint } from '../../types.ts'

interface CheckBoundariesOptions {
  depConstraints?: DepConstraint[]
}

const SOURCE_GLOB = '**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'
const EXCLUDES = ['node_modules/**', 'dist/**', '**/*.d.ts']

export default async function checkBoundaries(
  options: CheckBoundariesOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const workspaceRoot = context.root
  const graph: ProjectGraph = context.projectGraph ?? (await createProjectGraphAsync())
  const constraints = options.depConstraints ?? []
  const tags = projectTags(graph)
  const index = projectIndex(graph)
  const tsPaths = loadTsPaths(workspaceRoot)

  const violations: string[] = []

  for (const [projectName, node] of Object.entries(graph.nodes)) {
    const sourceTags = tags.get(projectName) ?? []
    if (sourceTags.length === 0) {
      continue // Untagged projects are unconstrained (permissive default)
    }
    const root = node.data.root
    if (root === '.' || root === '') {
      continue // The root project is not a boundary citizen
    }
    const absRoot = join(workspaceRoot, root)
    const files = globSync(SOURCE_GLOB, {
      cwd: absRoot,
      exclude: EXCLUDES,
    })
    logDebug('nx-devkit/boundaries', `${projectName}: scanning ${files.length} files`)

    for (const file of files) {
      const fileAbs = join(absRoot, file)
      const records = collectImports(
        fileAbs,
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a workspace source file under an inferred project root
        readFileSync(fileAbs, 'utf8'),
      )
      for (const record of records) {
        const target = resolveImport(record.specifier, fileAbs, index, tsPaths, workspaceRoot)
        if (!target || target === projectName) {
          continue
        }
        const targetTags = tags.get(target) ?? []
        if (!isAllowed(sourceTags, targetTags, constraints)) {
          const relFile = relative(workspaceRoot, fileAbs)
          violations.push(
            `${relFile}:${record.line} — ${projectName} (${sourceTags.join(',')}) cannot depend on ${target} (${targetTags.join(',') || 'untagged'}) via "${record.specifier}"`,
          )
        }
      }
    }
  }

  if (violations.length > 0) {
    logger.error(`check-boundaries: ${violations.length} violation(s)`)
    for (const v of violations) {
      logger.error(`  ${v}`)
    }
    return { success: false }
  }
  if (isVerbose()) {
    logger.info('check-boundaries: no violations')
  }
  return { success: true }
}
