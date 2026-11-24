import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { registerPlugin } from '@nx-devkit/internal';

export interface NxDaggerInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/dagger';

/**
 * Register the plugin in nx.json. No peer dependency is installed — the
 * plugin reads dagger.json and the `dagger` binary is a system CLI
 * (install it via `brew install dagger` or the dagger install script).
 */
export async function initGenerator(
  tree: Tree,
  options: NxDaggerInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath?.trim() || DEFAULT_PLUGIN_PATH;

  registerPlugin(tree, pluginPath);

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — eligible in-workspace dagger.json files now infer projects with call targets.`,
    '2. Inspect inferred targets:',
    '   bunx nx show projects',
    '3. Run a module without declared functions:',
    '   bunx nx run --project=<project> --target=dagger:call',
    '   Or a declared function:',
    '   bunx nx run --project=<project> --target=dagger:call:<function>',
    '4. Requires the dagger CLI on PATH (https://docs.dagger.io/install).',
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => {};
}

export default initGenerator;
