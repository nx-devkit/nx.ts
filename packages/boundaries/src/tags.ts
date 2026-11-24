import type { ProjectGraph } from '@nx/devkit';
import type { TagInference } from './types.ts';

/** First-root-segment → inferred type tags. `dir:<segment>` is added separately. */
const DEFAULT_TYPE_MAP: Record<string, string[]> = {
  app: ['type:app'],
  apps: ['type:app'],
  e2e: ['type:e2e'],
  lib: ['type:lib'],
  libs: ['type:lib'],
  packages: ['type:lib'],
};

export interface ResolvedInference {
  dir: boolean;
  types: Record<string, string[]>;
}

/** Normalize the `inferTags` option (`true`/`undefined` → defaults, `false` → off). */
export function resolveInference(option: boolean | TagInference | undefined): ResolvedInference {
  if (option === false) {
    return { dir: false, types: {} };
  }
  const o = typeof option === 'object' ? option : {};
  const types = { ...DEFAULT_TYPE_MAP };
  for (const [segment, tags] of Object.entries(o.types ?? {})) {
    if (tags.length === 0) {
      delete types[segment];
    } else {
      types[segment] = tags;
    }
  }
  return { dir: o.dir ?? true, types };
}

function inferWithResolved(root: string, resolved: ResolvedInference): string[] {
  const segment = root.replace(/\\/g, '/').split('/')[0] ?? '';
  if (!segment || segment === '.') {
    return [];
  }
  return [
    ...(resolved.dir ? [`dir:${segment}`] : []),
    // Own-property check: `resolved.types` is a plain object, so a segment
    // like `constructor` would otherwise read (and spread) a prototype member.
    ...(Object.hasOwn(resolved.types, segment) ? (resolved.types[segment] ?? []) : []),
  ];
}

/**
 * Tags derived from a project root's directory layout: `dir:<first-segment>`
 * plus the type tags mapped for that segment. The workspace root gets none.
 */
export function inferTagsFromRoot(root: string, option?: boolean | TagInference): string[] {
  return inferWithResolved(root, resolveInference(option));
}

/**
 * Project name → effective tags. Explicit `nx.tags` always win; projects
 * without them fall back to directory-layout inference (unless disabled).
 */
export function projectTags(
  graph: ProjectGraph,
  inferTags?: boolean | TagInference,
): Map<string, string[]> {
  const inference = resolveInference(inferTags);
  const map = new Map<string, string[]>();
  for (const [name, node] of Object.entries(graph.nodes)) {
    const explicit = node.data.tags ?? [];
    map.set(name, explicit.length > 0 ? explicit : inferWithResolved(node.data.root, inference));
  }
  return map;
}

/** Project name → { name, root } for import resolution. */
export function projectIndex(graph: ProjectGraph): {
  byName: Map<string, string>;
  roots: { name: string; root: string }[];
} {
  const byName = new Map<string, string>();
  const roots: { name: string; root: string }[] = [];
  for (const [name, node] of Object.entries(graph.nodes)) {
    const root = node.data.root.replace(/\\/g, '/');
    roots.push({ name, root });
    const npmName = node.data.metadata?.js?.packageName ?? node.data.name;
    if (typeof npmName === 'string') {
      byName.set(npmName, name);
    }
    // A project name must not overwrite another project's npm package alias.
    if (!byName.has(name)) {
      byName.set(name, name);
    }
  }
  // Longest root first so nested projects win on prefix matches.
  roots.sort((a, b) => b.root.length - a.root.length);
  return { byName, roots };
}
