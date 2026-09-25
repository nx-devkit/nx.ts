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

interface ScanContext {
  workspaceRoot: string
  index: ReturnType<typeof projectIndex>
  tsPaths: ReturnType<typeof loadTsPaths>
  tags: Map<string, string[]>
  constraints: DepConstraint[]
}

const SOURCE_GLOB = '**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'

// Node's globSync `exclude` semantics for pattern arrays vary by version —
// a segment callback is unambiguous everywhere.
const isExcluded = (p: string): boolean => {
  const segs = p.split(/[\\/]/)
  return segs.includes('node_modules') || segs.includes('dist') || p.endsWith('.d.ts')
}

function scanProject(
  projectName: string,
  sourceTags: string[],
  root: string,
  ctx: ScanContext,
): string[] {
  const absRoot = join(ctx.workspaceRoot, root)
  const files = globSync(SOURCE_GLOB, { cwd: absRoot, exclude: isExcluded })
  logDebug('nx-devkit/boundaries', `${projectName}: scanning ${files.length} files`)

  const violations: string[] = []
  for (const file of files) {
    const fileAbs = join(absRoot, file)
    let source: string
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a workspace source file under an inferred project root
      source = readFileSync(fileAbs, 'utf8')
    } catch (error) {
      logger.warn(
        `check-boundaries: skipping unreadable file ${fileAbs}: ${(error as Error).message}`,
      )
      continue
    }
    const records = collectImports(fileAbs, source)
    for (const record of records) {
      const target = resolveImport(
        record.specifier,
        fileAbs,
        ctx.index,
        ctx.tsPaths,
        ctx.workspaceRoot,
      )
      if (!target || target === projectName) {
        continue
      }
      const targetTags = ctx.tags.get(target) ?? []
      if (!isAllowed(sourceTags, targetTags, ctx.constraints)) {
        const relFile = relative(ctx.workspaceRoot, fileAbs)
        violations.push(
          `${relFile}:${record.line} — ${projectName} (${sourceTags.join(',')}) cannot depend on ${target} (${targetTags.join(',') || 'untagged'}) via "${record.specifier}"`,
        )
      }
    }
  }
  return violations
}

export default async function checkBoundaries(
  options: CheckBoundariesOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const graph: ProjectGraph = context.projectGraph ?? (await createProjectGraphAsync())
  const ctx: ScanContext = {
    workspaceRoot: context.root,
    index: projectIndex(graph),
    tsPaths: loadTsPaths(context.root),
    tags: projectTags(graph),
    constraints: options.depConstraints ?? [],
  }

  const violations: string[] = []
  for (const [projectName, node] of Object.entries(graph.nodes)) {
    const sourceTags = ctx.tags.get(projectName) ?? []
    const root = node.data.root
    // Untagged projects are unconstrained (permissive default).
    // The root project is excluded — it is not a boundary citizen.
    if (sourceTags.length === 0 || root === '.' || root === '') {
      continue
    }
    violations.push(...scanProject(projectName, sourceTags, root, ctx))
  }

  if (violations.length === 0) {
    if (isVerbose()) {
      logger.info('check-boundaries: no violations')
    }
    return { success: true }
  }
  logger.error(`check-boundaries: ${violations.length} violation(s)`)
  for (const v of violations) {
    logger.error(`  ${v}`)
  }
  return { success: false }
}
