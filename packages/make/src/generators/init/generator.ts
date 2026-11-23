import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { registerPlugin, resolveRootProjectName } from '@nx-devkit/internal';

export interface NxMakeInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/make';

/**
 * Register the plugin in nx.json. No dependency is installed — `make` is
 * a system tool on the consumer's PATH, not an npm package.
 */
export async function initGenerator(
  tree: Tree,
  options: NxMakeInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath || DEFAULT_PLUGIN_PATH;
  const projectName = resolveRootProjectName(tree) ?? '{root-project}';

  registerPlugin(tree, pluginPath);

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — Makefile rules are now Nx targets.`,
    '2. Inspect inferred targets:',
    '   bunx nx show projects',
    `3. Run a goal:  bunx nx run ${projectName}:make:<goal>`,
    '4. Caching is off by default — set options.cache to true on the plugin entry to opt in.',
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => {};
}

export default initGenerator;
