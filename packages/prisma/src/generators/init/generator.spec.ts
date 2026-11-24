import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { describe, expect, it, vi } from 'vitest';
import { initGenerator } from './generator.ts';

// The GeneratorCallback returned by initGenerator triggers a real
// package-manager install. Keep the real addDependenciesToPackageJson
// (it mutates the tree synchronously) but stub the install-spawning
// callback so specs exercise the full lifecycle without spawning npm.
const mocks = vi.hoisted(() => ({ installTask: vi.fn(() => Promise.resolve()) }));
vi.mock('@nx/devkit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nx/devkit')>();
  return {
    ...actual,
    addDependenciesToPackageJson: vi.fn(
      (tree: Tree, deps: Record<string, string>, devDeps: Record<string, string>) => {
        actual.addDependenciesToPackageJson(tree, deps, devDeps);
        return mocks.installTask;
      },
    ),
  };
});

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
  it('registers @nx-devkit/prisma in nx.json plugins', async () => {
    const tree = createTree();

    await initGenerator(tree, {});

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.some((p) => p.plugin === '@nx-devkit/prisma')).toBe(true);
  });

  it('does not duplicate the plugin entry on rerun', async () => {
    const tree = createTree();

    await initGenerator(tree, {});
    await initGenerator(tree, {});

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.filter((p) => p.plugin === '@nx-devkit/prisma')).toHaveLength(1);
  });

  it('does not duplicate a string-form plugin entry', async () => {
    const tree = createTree();
    tree.write('nx.json', JSON.stringify({ plugins: ['@nx-devkit/prisma'] }));

    await initGenerator(tree, {});

    expect(readPlugins(tree)).toEqual(['@nx-devkit/prisma']);
  });

  it('honors a custom pluginPath', async () => {
    const tree = createTree();

    await initGenerator(tree, { pluginPath: './packages/prisma/src/plugin.ts' });

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.some((p) => p.plugin === './packages/prisma/src/plugin.ts')).toBe(true);
  });

  it('preserves comments and trailing commas in a JSONC nx.json', async () => {
    const tree = createTree();
    tree.write('nx.json', '{\n  // keep this comment\n  "namedInputs": {},\n}\n');

    await initGenerator(tree, {});

    const text = tree.read('nx.json', 'utf8') ?? '';
    expect(text).toContain('// keep this comment');
    expect(text).toContain('"namedInputs": {},');
    expect(text).toContain('"@nx-devkit/prisma"');
  });

  it('installs the prisma peer dependency into devDependencies', async () => {
    const tree = createTree();
    tree.write('package.json', JSON.stringify({ name: 'x' }));

    await initGenerator(tree, {});

    const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}');
    expect(pkg.devDependencies.prisma).toBe('^6.0.0 || ^7.0.0');
  });

  it('returns a callback that runs the deferred dependency install', async () => {
    const tree = createTree();
    tree.write('package.json', JSON.stringify({ name: 'x' }));
    mocks.installTask.mockClear();

    const callback = await initGenerator(tree, {});
    await callback();

    expect(mocks.installTask).toHaveBeenCalledTimes(1);
  });
});
