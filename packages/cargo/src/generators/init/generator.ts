import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { registerPlugin } from '@nx-devkit/internal';

export interface NxCargoInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/cargo';

/**
 * Register the plugin in nx.json. No peer dependency is installed —
 * cargo is a system toolchain the plugin invokes, not an npm package.
 */
export async function initGenerator(
  tree: Tree,
  options: NxCargoInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath?.trim() || DEFAULT_PLUGIN_PATH;

  registerPlugin(tree, pluginPath);

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — Cargo.toml manifests now infer Nx projects.`,
    '2. Inspect inferred projects and targets:',
    '   bunx nx show projects',
    '3. Build a crate:        bunx nx run <crate>:build   (cargo build -p <crate>)',
    '4. Test the workspace:   bunx nx run-many -t test    (cargo test -p <crate>)',
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => {};
}

export default initGenerator;
