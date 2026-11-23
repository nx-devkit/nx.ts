import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { registerPlugin } from '@nx-devkit/internal';

export interface NxTurboInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/turbo';

/**
 * Register the plugin in nx.json. No peer dependency is installed — the
 * plugin reads turbo.json and never invokes the `turbo` binary.
 */
export async function initGenerator(
  tree: Tree,
  options: NxTurboInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath || DEFAULT_PLUGIN_PATH;

  registerPlugin(tree, pluginPath);

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — turbo.json tasks are now Nx targets.`,
    '2. Inspect inferred targets:',
    '   bunx nx show projects',
    '3. Run the task graph just like `turbo run`:',
    '   bunx nx run-many -t build',
    '4. turbo --filter equivalents: bunx nx run-many -t build --projects=<name>',
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => {};
}

export default initGenerator;
