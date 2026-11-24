import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { describe, expect, it, vi } from 'vitest';
import { initGenerator, type NxDrizzleInitOptions } from './generator.ts';

// The returned callback triggers a real package-manager install. Keep the
// real addDependenciesToPackageJson (it mutates the tree synchronously) but
// stub the install-spawning callback so specs exercise the full lifecycle
// without spawning npm. Same pattern as packages/internal/init-generator.spec.
vi.mock('@nx/devkit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nx/devkit')>();
  return {
    ...actual,
    addDependenciesToPackageJson: vi.fn(
      (tree: Tree, deps: Record<string, string>, devDeps: Record<string, string>) => {
        actual.addDependenciesToPackageJson(tree, deps, devDeps);
        return () => Promise.resolve();
      },
    ),
  };
});

// With formatter 'none' no formatter config is seeded into the tree, so formatFiles detects nothing and generated content is asserted verbatim.
function createTree(): Tree {
  const tree = createTreeWithEmptyWorkspace({ formatter: 'none' });
  tree.write('nx.json', JSON.stringify({}));
  return tree;
}

// Capture and invoke the GeneratorCallback so specs exercise the
// dependency-install lifecycle (install side effect stubbed above).
async function runInit(tree: Tree, options: NxDrizzleInitOptions = {}): Promise<void> {
  const installTask = await initGenerator(tree, options);
  await installTask();
}

function readPlugins(tree: Tree): unknown[] {
  const nxJson = JSON.parse(tree.read('nx.json', 'utf8') ?? '{}');
  return (nxJson.plugins as unknown[]) ?? [];
}

describe('initGenerator', () => {
  it('registers @nx-devkit/drizzle in nx.json plugins', async () => {
    const tree = createTree();

    await runInit(tree);

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.some((p) => p.plugin === '@nx-devkit/drizzle')).toBe(true);
  });

  it('does not duplicate the plugin entry on rerun', async () => {
    const tree = createTree();

    await runInit(tree);
    await runInit(tree);

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.filter((p) => p.plugin === '@nx-devkit/drizzle')).toHaveLength(1);
  });

  it('does not duplicate a string-form plugin entry', async () => {
    const tree = createTree();
    tree.write('nx.json', JSON.stringify({ plugins: ['@nx-devkit/drizzle'] }));

    await runInit(tree);

    expect(readPlugins(tree)).toEqual(['@nx-devkit/drizzle']);
  });

  it('honors a custom pluginPath', async () => {
    const tree = createTree();

    await runInit(tree, { pluginPath: './packages/drizzle/src/plugin.ts' });

    const plugins = readPlugins(tree) as Array<{ plugin: string }>;
    expect(plugins.some((p) => p.plugin === './packages/drizzle/src/plugin.ts')).toBe(true);
  });

  it('preserves comments and formatting in nx.json', async () => {
    const tree = createTree();
    tree.write('nx.json', '{\n  // keep me\n  "plugins": ["other-plugin"]\n}\n');

    await runInit(tree);

    expect(tree.read('nx.json', 'utf8')).toBe(
      '{\n  // keep me\n  "plugins": [\n    "other-plugin",\n    {\n      "options": {},\n      "plugin": "@nx-devkit/drizzle"\n    }\n  ]\n}\n',
    );
  });

  it('installs the peer dependency into devDependencies', async () => {
    const tree = createTree();
    tree.write('package.json', JSON.stringify({ name: 'x' }));

    await runInit(tree);

    const pkg = JSON.parse(tree.read('package.json', 'utf8') ?? '{}');
    expect(pkg.devDependencies['drizzle-kit']).toBe('^0.31.0');
  });
});
