import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { describe, expect, it } from 'vitest';
import { initGenerator } from './generator.ts';

// With formatter 'none' no formatter config is seeded into the tree, so formatFiles detects nothing and generated content is asserted verbatim.
function createTree(): Tree {
  const tree = createTreeWithEmptyWorkspace({ formatter: 'none' });
  tree.write('nx.json', JSON.stringify({}));
  return tree;
}

function readPlugins(tree: Tree): unknown[] {
  const nxJson = JSON.parse(tree.read('nx.json', 'utf8') ?? '{}');
  return (nxJson.plugins as unknown[]) ?? [];
}

describe('initGenerator', () => {
  it('registers @nx-devkit/ci-lint in nx.json plugins', async () => {
    const tree = createTree();

    await initGenerator(tree, {});

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.some((p) => p.plugin === '@nx-devkit/ci-lint')).toBe(true);
  });

  it('does not duplicate the plugin entry on rerun', async () => {
    const tree = createTree();

    await initGenerator(tree, {});
    await initGenerator(tree, {});

    expect(readPlugins(tree)).toEqual([{ options: {}, plugin: '@nx-devkit/ci-lint' }]);
  });

  it('does not duplicate a string-form plugin entry', async () => {
    const tree = createTree();
    tree.write('nx.json', JSON.stringify({ plugins: ['@nx-devkit/ci-lint'] }));

    await initGenerator(tree, {});

    expect(readPlugins(tree)).toEqual(['@nx-devkit/ci-lint']);
  });

  it('honours a custom pluginPath', async () => {
    const tree = createTree();

    await initGenerator(tree, { pluginPath: './local/plugin.ts' });

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.some((p) => p.plugin === './local/plugin.ts')).toBe(true);
  });

  it('does not install the npm actionlint package — it is a WASM API, not the CLI on PATH', async () => {
    const tree = createTree();
    tree.write('package.json', JSON.stringify({ name: 'x' }));

    await initGenerator(tree, {});

    const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}');
    expect(pkg.devDependencies ?? {}).not.toHaveProperty('actionlint');
  });
});
