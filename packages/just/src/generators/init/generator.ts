import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { registerPlugin, resolveRootProjectName } from '@nx-devkit/internal';

export interface NxJustInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/just';

/**
 * Register the plugin in nx.json. No dependency is installed — `just` is
 * a system tool (https://just.systems), not an npm package; the plugin
 * only reads justfiles and never invokes the binary at inference time.
 */
export async function initGenerator(
  tree: Tree,
  options: NxJustInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath || DEFAULT_PLUGIN_PATH;
  const projectName = resolveRootProjectName(tree) ?? '{root-project}';

  registerPlugin(tree, pluginPath);

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — every justfile/JUSTFILE/.justfile/just.just now yields just:<recipe> targets.`,
    '2. Inspect inferred targets:',
    '   bunx nx show projects',
    `3. Run a recipe:  bunx nx run ${projectName}:just:build`,
    '4. Parameterized recipes take args after -- :  bunx nx run <proj>:just:<recipe> -- <args>',
    '5. Requires the `just` binary on PATH (https://just.systems) — nothing is installed via npm.',
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => {};
}

export default initGenerator;
