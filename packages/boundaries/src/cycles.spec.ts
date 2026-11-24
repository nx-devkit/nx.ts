import type { ProjectGraph } from '@nx/devkit';
import { describe, expect, it } from 'vitest';
import { findCircularDependencies } from './cycles.ts';

function graph(
  nodes: string[],
  deps: Record<string, { target: string; type?: string }[]>,
): ProjectGraph {
  const graphNodes: ProjectGraph['nodes'] = {};
  for (const n of nodes) {
    graphNodes[n] = {
      name: n,
      type: 'lib',
      data: { root: `libs/${n}`, name: n },
    } as ProjectGraph['nodes'][string];
  }
  const dependencies: ProjectGraph['dependencies'] = {};
  for (const [source, list] of Object.entries(deps)) {
    dependencies[source] = list.map((d) => ({
      source,
      target: d.target,
      type: (d.type ?? 'static') as never,
    }));
  }
  return { nodes: graphNodes, dependencies };
}

describe('findCircularDependencies', () => {
  it('returns no cycles for a DAG', () => {
    const g = graph(['a', 'b', 'c'], {
      a: [{ target: 'b' }],
      b: [{ target: 'c' }],
    });
    expect(findCircularDependencies(g)).toEqual([]);
  });

  it('detects a two-project cycle', () => {
    const g = graph(['a', 'b'], {
      a: [{ target: 'b' }],
      b: [{ target: 'a' }],
    });
    const cycles = findCircularDependencies(g);
    expect(cycles).toHaveLength(1);
    const cycle = cycles[0]!;
    expect(cycle.path[0]).toBe(cycle.path[cycle.path.length - 1]); // closed path
    expect(new Set(cycle.path)).toEqual(new Set(['a', 'b']));
    expect(cycle.members).toEqual(['a', 'b']);
  });

  it('detects a three-project cycle', () => {
    const g = graph(['a', 'b', 'c', 'd'], {
      a: [{ target: 'b' }],
      b: [{ target: 'c' }],
      c: [{ target: 'a' }, { target: 'd' }],
    });
    const cycles = findCircularDependencies(g);
    expect(cycles).toHaveLength(1);
    // Assert the exact closed witness — every consecutive hop is a real edge.
    expect(cycles[0]!.path).toEqual(['a', 'b', 'c', 'a']);
    expect(cycles[0]!.members).toEqual(['a', 'b', 'c']);
  });

  it('reports each strongly-connected component once', () => {
    const g = graph(['a', 'b', 'c', 'x', 'y'], {
      a: [{ target: 'b' }],
      // b -> c is an extra internal edge inside the {a,b,c} component —
      // it must not spawn a duplicate cycle report.
      b: [{ target: 'a' }, { target: 'c' }],
      c: [{ target: 'a' }],
      x: [{ target: 'y' }],
      y: [{ target: 'x' }],
    });
    const cycles = findCircularDependencies(g);
    expect(cycles).toHaveLength(2);
    expect(cycles.map((c) => c.members)).toEqual([
      ['a', 'b', 'c'],
      ['x', 'y'],
    ]);
  });

  it('detects a self-dependency', () => {
    const g = graph(['a'], { a: [{ target: 'a' }] });
    const cycles = findCircularDependencies(g);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual({ members: ['a'], path: ['a', 'a'] });
  });

  it('ignores implicit dependencies', () => {
    const g = graph(['a', 'b'], {
      a: [{ target: 'b', type: 'implicit' }],
      b: [{ target: 'a', type: 'implicit' }],
    });
    expect(findCircularDependencies(g)).toEqual([]);
  });

  it('ignores edges to projects not in the graph', () => {
    const g = graph(['a'], {
      a: [{ target: 'npm:lodash' }],
    });
    expect(findCircularDependencies(g)).toEqual([]);
  });
});
