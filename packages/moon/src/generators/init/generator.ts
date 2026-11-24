import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { registerPlugin } from '@nx-devkit/internal';

export interface NxMoonInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/moon';

/**
 * Register the plugin in nx.json. No peer dependency is installed — the
 * plugin reads moon.yml and never invokes the `moon` binary.
 */
export async function initGenerator(
  tree: Tree,
  options: NxMoonInitOptions = {},
): Promise<GeneratorCallback> {
  // Whitespace-only or padded input would write an unresolvable plugin
  // specifier into nx.json — trim and fall back to the default.
  const pluginPath = options.pluginPath?.trim() || DEFAULT_PLUGIN_PATH;

  registerPlugin(tree, pluginPath);

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — moon.yml tasks are now Nx targets.`,
    '2. Inspect inferred targets:',
    '   bunx nx show projects',
    '3. Run the task graph just like `moon run`:',
    '   bunx nx run-many -t build',
    '4. moon run <project>:<task> equivalent: bunx nx run <project>:<task>',
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => {};
}

export default initGenerator;
