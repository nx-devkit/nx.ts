import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export interface ProjectIndex {
  byName: Map<string, string>
  roots: { name: string; root: string }[]
}

export interface PathMapping {
  pattern: string
  targets: string[]
}

const EXTENSIONS = [
  '',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '/index.ts',
  '/index.js',
]

function fileToProject(
  absPath: string,
  roots: { name: string; root: string }[],
  workspaceRoot: string,
): string | null {
  for (const candidate of EXTENSIONS.map((ext) => absPath + ext)) {
    if (!existsSync(candidate)) {
      continue
    }
    const rel = candidate.slice(workspaceRoot.length).replace(/\\/g, '/').replace(/^\//, '')
    // Roots are sorted longest-first — nested projects win
    for (const { name, root } of roots) {
      if (root === '.' || root === '') {
        continue // Root project would swallow everything; skip
      }
      if (rel === root || rel.startsWith(`${root}/`)) {
        return name
      }
    }
    return null
  }
  return null
}

/** Resolve an import specifier to a project name, or null (external/builtin/unresolvable). */
export function resolveImport(
  specifier: string,
  fromFileAbs: string,
  index: ProjectIndex,
  tsPaths: PathMapping[],
  workspaceRoot: string,
): string | null {
  if (specifier.startsWith('.')) {
    return fileToProject(resolve(dirname(fromFileAbs), specifier), index.roots, workspaceRoot)
  }
  if (isAbsolute(specifier) || specifier.startsWith('node:') || specifier.startsWith('bun:')) {
    return null
  }
  // Bare specifier: workspace package name first, tsconfig paths second.
  const byName = index.byName.get(specifier)
  if (byName) {
    return byName
  }
  for (const mapping of tsPaths) {
    const resolved = matchPathMapping(specifier, mapping, workspaceRoot)
    if (resolved) {
      const project = fileToProject(resolved, index.roots, workspaceRoot)
      if (project) {
        return project
      }
    }
  }
  return null
}

function matchPathMapping(
  specifier: string,
  mapping: PathMapping,
  workspaceRoot: string,
): string | null {
  const star = mapping.pattern.indexOf('*')
  if (star === -1) {
    if (specifier !== mapping.pattern) {
      return null
    }
    const target = mapping.targets[0]
    return target ? join(workspaceRoot, target) : null
  }
  const [prefix, suffix] = [mapping.pattern.slice(0, star), mapping.pattern.slice(star + 1)]
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
    return null
  }
  const matched = specifier.slice(prefix.length, specifier.length - suffix.length)
  for (const target of mapping.targets) {
    const resolved = join(workspaceRoot, target.replace('*', matched))
    if (EXTENSIONS.some((ext) => existsSync(resolved + ext))) {
      return resolved
    }
  }
  return null
}

export function loadTsPaths(workspaceRoot: string): PathMapping[] {
  const out: PathMapping[] = []
  for (const file of ['tsconfig.base.json', 'tsconfig.json']) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed candidate basenames under the Nx workspace root
      const raw = JSON.parse(readFileSync(join(workspaceRoot, file), 'utf8')) as {
        compilerOptions?: { paths?: Record<string, string[]> }
      }
      for (const [pattern, targets] of Object.entries(raw.compilerOptions?.paths ?? {})) {
        out.push({ pattern, targets })
      }
    } catch {
      // No tsconfig at root — paths simply absent
    }
  }
  return out
}
