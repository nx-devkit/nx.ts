import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { describe, expect, it } from 'vitest';
import { initGenerator } from './generator.ts';

// With formatter 'none' no formatter config is seeded into the tree, so
// formatFiles detects nothing and generated content is asserted verbatim.
function createTree(files: Record<string, string> = {}): Tree {
  const tree = createTreeWithEmptyWorkspace({ formatter: 'none' });
  tree.write('nx.json', JSON.stringify({}));
  for (const [path, content] of Object.entries(files)) {
    tree.write(path, content);
  }
  return tree;
}

function readPlugins(tree: Tree): unknown[] {
  const nxJson = JSON.parse(tree.read('nx.json', 'utf8') ?? '{}');
  return (nxJson.plugins as unknown[]) ?? [];
}

describe('initGenerator', () => {
  it('registers @nx-devkit/git-hooks in nx.json plugins', async () => {
    const tree = createTree();

    await initGenerator(tree, {});

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.some((p) => p.plugin === '@nx-devkit/git-hooks')).toBe(true);
  });

  it('does not duplicate the plugin entry on rerun', async () => {
    const tree = createTree();

    await initGenerator(tree, {});
    await initGenerator(tree, {});

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.filter((p) => p.plugin === '@nx-devkit/git-hooks')).toHaveLength(1);
  });

  it('does not duplicate a string-form plugin entry', async () => {
    const tree = createTree();
    tree.write('nx.json', JSON.stringify({ plugins: ['@nx-devkit/git-hooks'] }));

    await initGenerator(tree, {});

    expect(readPlugins(tree)).toEqual(['@nx-devkit/git-hooks']);
  });

  it('honors a custom pluginPath', async () => {
    const tree = createTree();

    await initGenerator(tree, { pluginPath: './packages/git-hooks/src/plugin.ts' });

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.some((p) => p.plugin === './packages/git-hooks/src/plugin.ts')).toBe(true);
  });

  it('trims pluginPath and falls back to the default on whitespace', async () => {
    const tree = createTree();

    await initGenerator(tree, { pluginPath: '  ./local-plugin.ts  ' });
    let plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.some((p) => p.plugin === './local-plugin.ts')).toBe(true);

    const tree2 = createTree();
    await initGenerator(tree2, { pluginPath: '   ' });
    plugins = readPlugins(tree2) as Array<{ plugin: string }>;
    expect(plugins.some((p) => p.plugin === '@nx-devkit/git-hooks')).toBe(true);
  });

  it('preserves comments and formatting in nx.json', async () => {
    const tree = createTree();
    tree.write('nx.json', '{\n  // keep me\n  "plugins": ["other-plugin"]\n}\n');

    await initGenerator(tree, {});

    expect(tree.read('nx.json', 'utf8')).toBe(
      '{\n  // keep me\n  "plugins": [\n    "other-plugin",\n    {\n      "options": {},\n      "plugin": "@nx-devkit/git-hooks"\n    }\n  ]\n}\n',
    );
  });

  it('installs the lefthook peer dep when a lefthook config exists', async () => {
    const tree = createTree({
      'package.json': JSON.stringify({ name: 'x' }),
      'lefthook.yml': 'pre-commit:\n  commands:\n    lint:\n      run: npx eslint .\n',
    });

    await initGenerator(tree, {});

    const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}');
    expect(pkg.devDependencies['lefthook']).toBe('^1.0.0 || ^2.0.0');
  });

  it('does not install lefthook for a pre-commit-only workspace', async () => {
    const tree = createTree({
      'package.json': JSON.stringify({ name: 'x' }),
      '.pre-commit-config.yaml': 'repos: []\n',
    });

    await initGenerator(tree, {});

    const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}');
    expect(pkg.devDependencies?.['lefthook']).toBeUndefined();
  });

  it('detects a nested lefthook config and installs the peer dep', async () => {
    const tree = createTree({
      'package.json': JSON.stringify({ name: 'x' }),
      'packages/app/lefthook.yaml': 'pre-push:\n  commands:\n    t:\n      run: npm test\n',
    });

    await initGenerator(tree, {});

    const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}');
    expect(pkg.devDependencies['lefthook']).toBe('^1.0.0 || ^2.0.0');
  });

  it('ignores hook configs inside node_modules', async () => {
    const tree = createTree({
      'package.json': JSON.stringify({ name: 'x' }),
      'node_modules/dep/lefthook.yml': 'pre-commit: {}\n',
    });

    await initGenerator(tree, {});

    const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}');
    expect(pkg.devDependencies?.['lefthook']).toBeUndefined();
  });

  it('skips installing lefthook when already declared', async () => {
    const tree = createTree({
      'package.json': JSON.stringify({ name: 'x', devDependencies: { lefthook: '^2.0.0' } }),
      'lefthook.yml': 'pre-commit:\n  commands:\n    lint:\n      run: npx eslint .\n',
    });

    await initGenerator(tree, {});

    const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}');
    expect(pkg.devDependencies['lefthook']).toBe('^2.0.0');
  });
});
