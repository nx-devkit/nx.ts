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
  it('registers @nx-devkit/just in nx.json plugins', async () => {
    const tree = createTree();

    await initGenerator(tree, {});

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.some((p) => p.plugin === '@nx-devkit/just')).toBe(true);
  });

  it('does not duplicate the plugin entry on rerun', async () => {
    const tree = createTree();

    await initGenerator(tree, {});
    await initGenerator(tree, {});

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.filter((p) => p.plugin === '@nx-devkit/just')).toHaveLength(1);
  });

  it('does not duplicate a string-form plugin entry on rerun', async () => {
    const tree = createTree();
    tree.write('nx.json', JSON.stringify({ plugins: ['@nx-devkit/just'] }));

    await initGenerator(tree, {});

    const plugins = readPlugins(tree);
    expect(
      plugins.filter(
        (p) => p === '@nx-devkit/just' || (p as { plugin?: string }).plugin === '@nx-devkit/just',
      ),
    ).toHaveLength(1);
  });

  it('preserves JSONC comments and trailing commas in nx.json', async () => {
    const tree = createTree();
    tree.write(
      'nx.json',
      `{
  // keep this comment
  "targetDefaults": {},
}
`,
    );

    await initGenerator(tree, {});

    const text = tree.read('nx.json', 'utf8') ?? '';
    expect(text).toContain('// keep this comment');
    expect(text).toContain('"targetDefaults": {},');
    expect(text).toContain('@nx-devkit/just');
  });

  it('honors a custom pluginPath', async () => {
    const tree = createTree();

    await initGenerator(tree, { pluginPath: './packages/just/src/plugin.ts' });

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.some((p) => p.plugin === './packages/just/src/plugin.ts')).toBe(true);
  });

  it('installs no dependencies — just is a system binary, not an npm package', async () => {
    const tree = createTree();
    tree.write('package.json', JSON.stringify({ name: 'x' }));

    const installDeps = await initGenerator(tree, {});
    installDeps();

    const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}');
    expect(pkg).toEqual({ name: 'x' });
  });
});
