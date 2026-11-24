import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { describe, expect, it } from 'vitest';
import { initGenerator } from './generator.ts';

// formatter: 'none' — no formatter config is seeded into the tree, so
// formatFiles detects nothing and generated content is asserted verbatim.
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
  it('registers @nx-devkit/moon in nx.json plugins', async () => {
    const tree = createTree();

    await initGenerator(tree, {});

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.some((p) => p.plugin === '@nx-devkit/moon')).toBe(true);
  });

  it('does not duplicate the plugin entry on rerun', async () => {
    const tree = createTree();

    await initGenerator(tree, {});
    await initGenerator(tree, {});

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.filter((p) => p.plugin === '@nx-devkit/moon')).toHaveLength(1);
  });

  it('does not duplicate a string-form plugin entry', async () => {
    const tree = createTree();
    tree.write('nx.json', JSON.stringify({ plugins: ['@nx-devkit/moon'] }));

    await initGenerator(tree, {});

    expect(readPlugins(tree)).toEqual(['@nx-devkit/moon']);
  });

  it('honors a custom pluginPath', async () => {
    const tree = createTree();

    await initGenerator(tree, { pluginPath: './packages/moon/src/plugin.ts' });

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.some((p) => p.plugin === './packages/moon/src/plugin.ts')).toBe(true);
  });

  it('trims pluginPath and falls back on whitespace-only input', async () => {
    const padded = createTree();
    await initGenerator(padded, { pluginPath: '  ./tools/plugin.ts  ' });
    expect((readPlugins(padded) as Array<{ plugin: string }>)[0]?.plugin).toBe('./tools/plugin.ts');

    const blank = createTree();
    await initGenerator(blank, { pluginPath: '   ' });
    expect((readPlugins(blank) as Array<{ plugin: string }>)[0]?.plugin).toBe('@nx-devkit/moon');
  });

  it('installs no dependencies — the plugin only reads moon.yml', async () => {
    const tree = createTree();
    tree.write('package.json', JSON.stringify({ name: 'x' }));

    const installDeps = await initGenerator(tree, {});
    installDeps();

    const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}');
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies).toBeUndefined();
  });
});
