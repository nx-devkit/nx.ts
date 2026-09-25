import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parseJsonObject } from '@nx-devkit/internal'

export interface ProjectIndex {
  byName: Map<string, string>
  roots: { name: string; root: string }[]
}

export interface PathMapping {
  pattern: string
  targets: string[]
  /** Directory `paths` targets resolve against — tsconfig dir + baseUrl. */
  baseDir: string
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

// TypeScript resolves `./foo.js` to `./foo.ts` — apply the same substitution
// so Node-style source imports cannot bypass boundary checks.
const JS_TO_TS: Record<string, string> = {
  '.js': '.ts',
  '.jsx': '.tsx',
  '.mjs': '.mts',
  '.cjs': '.cts',
}

function* candidatePaths(absPath: string): Generator<string> {
  yield absPath
  const ext = Object.keys(JS_TO_TS).find((e) => absPath.endsWith(e))
  if (ext) {
    yield absPath.slice(0, -ext.length) + (JS_TO_TS[ext] ?? ext)
  }
}

function fileToProject(
  absPath: string,
  roots: { name: string; root: string }[],
  workspaceRoot: string,
): string | null {
  for (const base of candidatePaths(absPath)) {
    for (const ext of EXTENSIONS) {
      const candidate = base + ext
      if (!existsSync(candidate)) {
        continue
      }
      const rel = relative(workspaceRoot, candidate).replace(/\\/g, '/')
      if (rel.startsWith('..') || isAbsolute(rel)) {
        return null // Outside the workspace — no project owns it
      }
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
  // Longest-prefix-first: a broad alias must not shadow a narrower one.
  const ordered = [...tsPaths].sort((a, b) => prefixLength(b) - prefixLength(a))
  for (const mapping of ordered) {
    const project = matchPathMapping(specifier, mapping, index.roots, workspaceRoot)
    if (project) {
      return project
    }
  }
  return null
}

function prefixLength(mapping: PathMapping): number {
  const star = mapping.pattern.indexOf('*')
  return star === -1 ? mapping.pattern.length : star
}

function matchPathMapping(
  specifier: string,
  mapping: PathMapping,
  roots: { name: string; root: string }[],
  workspaceRoot: string,
): string | null {
  const star = mapping.pattern.indexOf('*')
  if (star === -1) {
    if (specifier !== mapping.pattern) {
      return null
    }
    // Exact alias: try every fallback target until one resolves.
    for (const target of mapping.targets) {
      const project = fileToProject(join(mapping.baseDir, target), roots, workspaceRoot)
      if (project) {
        return project
      }
    }
    return null
  }
  const [prefix, suffix] = [mapping.pattern.slice(0, star), mapping.pattern.slice(star + 1)]
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
    return null
  }
  const matched = specifier.slice(prefix.length, specifier.length - suffix.length)
  for (const target of mapping.targets) {
    const resolved = join(mapping.baseDir, target.replace('*', matched))
    const project = fileToProject(resolved, roots, workspaceRoot)
    if (project) {
      return project
    }
  }
  return null
}

export function loadTsPaths(workspaceRoot: string): PathMapping[] {
  const out: PathMapping[] = []
  for (const file of ['tsconfig.base.json', 'tsconfig.json']) {
    const tsconfigPath = join(workspaceRoot, file)
    let raw: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed candidate basenames under the Nx workspace root
      raw = parseJsonObject(readFileSync(tsconfigPath, 'utf8'), tsconfigPath) as typeof raw
    } catch {
      continue // No readable tsconfig — paths simply absent
    }
    const baseDir = resolve(workspaceRoot, raw.compilerOptions?.baseUrl ?? '.')
    for (const [pattern, targets] of Object.entries(raw.compilerOptions?.paths ?? {})) {
      out.push({ pattern, targets, baseDir })
    }
  }
  return out
}
