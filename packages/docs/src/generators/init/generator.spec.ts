import childProcess from 'node:child_process';
import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  // The returned GeneratorCallback runs installPackagesTask → a real
  // `bun install` via execSync — stub it so invoking stays in-memory.
  beforeEach(() => {
    vi.spyOn(childProcess, 'execSync').mockReturnValue(Buffer.from(''));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers @nx-devkit/docs in nx.json plugins', async () => {
    const tree = createTree();

    await initGenerator(tree, {});

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.some((p) => p.plugin === '@nx-devkit/docs')).toBe(true);
  });

  it('does not duplicate the plugin entry on rerun', async () => {
    const tree = createTree();

    await initGenerator(tree, {});
    await initGenerator(tree, {});

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.filter((p) => p.plugin === '@nx-devkit/docs')).toHaveLength(1);
  });

  it('does not duplicate a string-form plugin entry', async () => {
    const tree = createTree();
    tree.write('nx.json', JSON.stringify({ plugins: ['@nx-devkit/docs'] }));

    await initGenerator(tree, {});

    expect(readPlugins(tree)).toEqual(['@nx-devkit/docs']);
  });

  it('honors a custom pluginPath', async () => {
    const tree = createTree();

    await initGenerator(tree, { pluginPath: './packages/docs/src/plugin.ts' });

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.some((p) => p.plugin === './packages/docs/src/plugin.ts')).toBe(true);
  });

  it('preserves comments and formatting in nx.json', async () => {
    const tree = createTree();
    tree.write('nx.json', '{\n  // keep me\n  "plugins": ["other-plugin"]\n}\n');

    await initGenerator(tree, {});

    expect(tree.read('nx.json', 'utf8')).toBe(
      '{\n  // keep me\n  "plugins": [\n    "other-plugin",\n    {\n      "options": {},\n      "plugin": "@nx-devkit/docs"\n    }\n  ]\n}\n',
    );
  });

  it('installs no peer deps when no docs config exists', async () => {
    const tree = createTree();
    tree.write('package.json', JSON.stringify({ name: 'x' }));

    const install = await initGenerator(tree, {});
    await install();

    const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}');
    expect(pkg.devDependencies).toBeUndefined();
    expect(childProcess.execSync).not.toHaveBeenCalled();
  });

  it('installs vitepress when a .vitepress config exists', async () => {
    const tree = createTree();
    tree.write('package.json', JSON.stringify({ name: 'x' }));
    tree.write('docs/.vitepress/config.ts', 'export default {}');

    const install = await initGenerator(tree, {});
    await install();

    const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}');
    expect(pkg.devDependencies.vitepress).toBe('^1.0.0 || ^2.0.0');
    expect(pkg.devDependencies.astro).toBeUndefined();
    expect(childProcess.execSync).toHaveBeenCalledWith(
      expect.stringContaining('install'),
      expect.anything(),
    );
  });

  it('installs astro when an astro.config exists', async () => {
    const tree = createTree();
    tree.write('package.json', JSON.stringify({ name: 'x' }));
    tree.write('site/astro.config.mjs', 'export default {}');

    const install = await initGenerator(tree, {});
    await install();

    const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}');
    expect(pkg.devDependencies.astro).toBe('^4.0.0 || ^5.0.0');
    expect(pkg.devDependencies.vitepress).toBeUndefined();
    expect(childProcess.execSync).toHaveBeenCalledWith(
      expect.stringContaining('install'),
      expect.anything(),
    );
  });

  it('installs both when both config kinds exist', async () => {
    const tree = createTree();
    tree.write('package.json', JSON.stringify({ name: 'x' }));
    tree.write('docs/.vitepress/config.ts', 'export default {}');
    tree.write('site/astro.config.ts', 'export default {}');

    const install = await initGenerator(tree, {});
    await install();

    const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}');
    expect(pkg.devDependencies.vitepress).toBe('^1.0.0 || ^2.0.0');
    expect(pkg.devDependencies.astro).toBe('^4.0.0 || ^5.0.0');
    expect(childProcess.execSync).toHaveBeenCalledWith(
      expect.stringContaining('install'),
      expect.anything(),
    );
  });

  it('skips peer deps already declared', async () => {
    const tree = createTree();
    tree.write('package.json', JSON.stringify({ name: 'x', devDependencies: { astro: '^5.1.0' } }));
    tree.write('site/astro.config.ts', 'export default {}');

    const install = await initGenerator(tree, {});
    await install();

    const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}');
    expect(pkg.devDependencies.astro).toBe('^5.1.0');
    expect(childProcess.execSync).not.toHaveBeenCalled();
  });
});
