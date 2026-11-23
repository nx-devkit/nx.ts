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
    expect(cycle[0]).toBe(cycle[cycle.length - 1]); // closed path
    expect(new Set(cycle)).toEqual(new Set(['a', 'b']));
  });

  it('detects a three-project cycle', () => {
    const g = graph(['a', 'b', 'c', 'd'], {
      a: [{ target: 'b' }],
      b: [{ target: 'c' }],
      c: [{ target: 'a' }, { target: 'd' }],
    });
    const cycles = findCircularDependencies(g);
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0])).toEqual(new Set(['a', 'b', 'c']));
  });

  it('reports each strongly-connected component once', () => {
    const g = graph(['a', 'b', 'x', 'y'], {
      a: [{ target: 'b' }],
      b: [{ target: 'a' }],
      x: [{ target: 'y' }],
      y: [{ target: 'x' }],
      // extra internal edge does not spawn a duplicate cycle
    });
    expect(findCircularDependencies(g)).toHaveLength(2);
  });

  it('detects a self-dependency', () => {
    const g = graph(['a'], { a: [{ target: 'a' }] });
    const cycles = findCircularDependencies(g);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(['a', 'a']);
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
