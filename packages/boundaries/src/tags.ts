import type { ProjectGraph } from '@nx/devkit'

/** Project name → declared tags (from `nx.tags` in package.json or project.json). */
export function projectTags(graph: ProjectGraph): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const [name, node] of Object.entries(graph.nodes)) {
    map.set(name, node.data.tags ?? [])
  }
  return map
}

/** Project name → { name, root } for import resolution. */
export function projectIndex(graph: ProjectGraph): {
  byName: Map<string, string>
  roots: { name: string; root: string }[]
} {
  const byName = new Map<string, string>()
  const roots: { name: string; root: string }[] = []
  for (const [name, node] of Object.entries(graph.nodes)) {
    const root = node.data.root.replace(/\\/g, '/')
    roots.push({ name, root })
    const npmName = node.data.metadata?.js?.packageName ?? node.data.name
    if (typeof npmName === 'string') {
      byName.set(npmName, name)
    }
    byName.set(name, name)
  }
  // Longest root first so nested projects win on prefix matches.
  roots.sort((a, b) => b.root.length - a.root.length)
  return { byName, roots }
}
