import type { ProjectGraph } from '@nx/devkit';
import { describe, expect, it } from 'vitest';
import { inferTagsFromRoot, projectTags } from './tags.ts';

function graphWith(entries: { name: string; root: string; tags?: string[] }[]): ProjectGraph {
  const nodes: ProjectGraph['nodes'] = {};
  for (const e of entries) {
    nodes[e.name] = {
      name: e.name,
      type: 'lib',
      data: { root: e.root, name: e.name, ...(e.tags ? { tags: e.tags } : {}) },
    } as ProjectGraph['nodes'][string];
  }
  return { nodes, dependencies: {} };
}

describe('inferTagsFromRoot', () => {
  it('derives dir:<segment> plus a type tag for known layouts', () => {
    expect(inferTagsFromRoot('packages/foo')).toEqual(['dir:packages', 'type:lib']);
    expect(inferTagsFromRoot('apps/web')).toEqual(['dir:apps', 'type:app']);
    expect(inferTagsFromRoot('libs/util')).toEqual(['dir:libs', 'type:lib']);
    expect(inferTagsFromRoot('e2e/web-e2e')).toEqual(['dir:e2e', 'type:e2e']);
  });

  it('derives only dir:<segment> for unknown layouts', () => {
    expect(inferTagsFromRoot('modules/billing')).toEqual(['dir:modules']);
  });

  it('returns no tags for the workspace root', () => {
    expect(inferTagsFromRoot('.')).toEqual([]);
    expect(inferTagsFromRoot('')).toEqual([]);
  });

  it('uses the first root segment for nested projects', () => {
    expect(inferTagsFromRoot('libs/feature/nested')).toEqual(['dir:libs', 'type:lib']);
  });

  it('does not read inherited Object.prototype members as type mappings', () => {
    // A first segment like `constructor`/`toString` must not spread a
    // prototype member — it gets dir:<segment> and no type tags.
    expect(inferTagsFromRoot('constructor/lib')).toEqual(['dir:constructor']);
    expect(inferTagsFromRoot('toString/lib')).toEqual(['dir:toString']);
  });

  it('honors inference options', () => {
    expect(inferTagsFromRoot('apps/web', { dir: false })).toEqual(['type:app']);
    expect(inferTagsFromRoot('modules/billing', { types: { modules: ['type:lib'] } })).toEqual([
      'dir:modules',
      'type:lib',
    ]);
    // Empty array removes a default mapping.
    expect(inferTagsFromRoot('apps/web', { types: { apps: [] } })).toEqual(['dir:apps']);
  });
});

describe('projectTags with inference', () => {
  it('infers tags for untagged projects by default', () => {
    const graph = graphWith([
      { name: 'web', root: 'apps/web' },
      { name: 'util', root: 'libs/util' },
    ]);
    const tags = projectTags(graph);
    expect(tags.get('web')).toEqual(['dir:apps', 'type:app']);
    expect(tags.get('util')).toEqual(['dir:libs', 'type:lib']);
  });

  it('explicit nx.tags always win over inference', () => {
    const graph = graphWith([{ name: 'web', root: 'apps/web', tags: ['scope:shop'] }]);
    expect(projectTags(graph).get('web')).toEqual(['scope:shop']);
  });

  it('infers nothing when inferTags is false', () => {
    const graph = graphWith([
      { name: 'web', root: 'apps/web' },
      { name: 'util', root: 'libs/util', tags: ['type:util'] },
    ]);
    const tags = projectTags(graph, false);
    expect(tags.get('web')).toEqual([]);
    expect(tags.get('util')).toEqual(['type:util']);
  });

  it('never tags the root project', () => {
    const graph = graphWith([{ name: 'root', root: '.' }]);
    expect(projectTags(graph).get('root')).toEqual([]);
  });
});
