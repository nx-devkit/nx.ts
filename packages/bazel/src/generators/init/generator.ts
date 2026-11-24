import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { registerPlugin } from '@nx-devkit/internal';

export interface NxBazelInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/bazel';

/**
 * Register the plugin in nx.json. No peer dependency is installed —
 * `bazel` is a system binary (bazelisk), not an npm package.
 */
export async function initGenerator(
  tree: Tree,
  options: NxBazelInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath || DEFAULT_PLUGIN_PATH;

  registerPlugin(tree, pluginPath);

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — dirs with a BUILD file now have bazel targets.`,
    '2. Inspect inferred targets:',
    '   bunx nx show projects',
    '3. Build every Bazel package alongside the rest of the repo:',
    '   bunx nx run-many -t bazel:build',
    '4. Requires the `bazel` (or bazelisk) binary on PATH.',
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => {};
}

export default initGenerator;
