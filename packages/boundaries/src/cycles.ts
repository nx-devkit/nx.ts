import type { ProjectGraph } from '@nx/devkit';

/**
 * Directed adjacency over workspace projects from `graph.dependencies`.
 * Edges to non-workspace targets (npm deps) and `implicit` deps are excluded —
 * neither is a real code-level dependency.
 */
function dependencyAdjacency(graph: ProjectGraph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const name of Object.keys(graph.nodes)) {
    adj.set(name, []);
  }
  for (const [source, deps] of Object.entries(graph.dependencies ?? {})) {
    if (!graph.nodes[source]) continue;
    const targets = adj.get(source);
    if (!targets) continue;
    for (const dep of deps) {
      if (dep.type === 'implicit' || !Object.hasOwn(graph.nodes, dep.target)) continue;
      targets.push(dep.target);
    }
  }
  // Deterministic traversal order.
  for (const targets of adj.values()) {
    targets.sort();
  }
  return adj;
}

/**
 * Find a closed walk `start → … → start` inside `component` via DFS.
 * Every node of a strongly-connected component lies on such a walk.
 */
function witnessCycle(start: string, component: Set<string>, adj: Map<string, string[]>): string[] {
  const stack: string[] = [start];
  const visited = new Set<string>([start]);
  const frames: { node: string; next: number }[] = [{ node: start, next: 0 }];
  while (frames.length > 0) {
    const frame = frames[frames.length - 1]!;
    const targets = adj.get(frame.node) ?? [];
    let advanced = false;
    for (; frame.next < targets.length; frame.next++) {
      const t = targets[frame.next]!;
      if (!component.has(t)) continue;
      if (t === start && stack.length > 1) {
        return [...stack, start];
      }
      if (t === start || visited.has(t)) continue;
      visited.add(t);
      stack.push(t);
      frames.push({ node: t, next: 0 });
      advanced = true;
      break;
    }
    if (!advanced) {
      frames.pop();
      stack.pop();
    }
  }
  // Unreachable by construction (SCC ⇒ closed walk exists) — but fail loud
  // would be wrong here; return the degenerate self-edge as a safe fallback.
  return [start, start];
}

export interface CircularDependency {
  /** Every project in the strongly-connected component (sorted). */
  members: string[];
  /** One witness closed walk for reporting — starts/ends on the smallest member. */
  path: string[];
}

/**
 * Circular dependencies in the project graph, one per strongly-connected
 * component (self-loops included). `members` covers the whole component —
 * `path` is only a witness and need not visit every member.
 */
export function findCircularDependencies(graph: ProjectGraph): CircularDependency[] {
  const adj = dependencyAdjacency(graph);

  // Tarjan's SCC — iterative to stay safe on deep graphs.
  const indexOf = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let index = 0;

  for (const root of [...adj.keys()].sort()) {
    if (indexOf.has(root)) continue;
    const work: { node: string; child: number }[] = [{ node: root, child: 0 }];
    indexOf.set(root, index);
    lowlink.set(root, index++);
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const node = frame.node;
      const targets = adj.get(node) ?? [];
      if (frame.child < targets.length) {
        const next = targets[frame.child++]!;
        if (!indexOf.has(next)) {
          indexOf.set(next, index);
          lowlink.set(next, index++);
          stack.push(next);
          onStack.add(next);
          work.push({ node: next, child: 0 });
        } else if (onStack.has(next)) {
          lowlink.set(node, Math.min(lowlink.get(node)!, indexOf.get(next)!));
        }
      } else {
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1]!.node;
          lowlink.set(parent, Math.min(lowlink.get(parent)!, lowlink.get(node)!));
        }
        if (lowlink.get(node) === indexOf.get(node)) {
          const component: string[] = [];
          let member = '';
          do {
            member = stack.pop()!;
            onStack.delete(member);
            component.push(member);
          } while (member !== node);
          components.push(component.sort());
        }
      }
    }
  }

  const cycles: CircularDependency[] = [];
  for (const component of components) {
    const [start] = component;
    if (component.length === 1) {
      // Only a self-loop counts as circular.
      if ((adj.get(start!) ?? []).includes(start!)) {
        cycles.push({ members: [start!], path: [start!, start!] });
      }
      continue;
    }
    cycles.push({
      members: component,
      path: witnessCycle(start!, new Set(component), adj),
    });
  }
  // Code-unit order — localeCompare would make report order host-dependent.
  cycles.sort((a, b) => (a.path[0]! < b.path[0]! ? -1 : a.path[0]! > b.path[0]! ? 1 : 0));
  return cycles;
}
