import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { registerPlugin, resolveRootProjectName } from '@nx-devkit/internal';

export interface NxDotfilesInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/dotfiles';

/**
 * Register the plugin in nx.json. No peer dependency is installed —
 * chezmoi and dotbot are system tools (brew/apt/pip), not npm packages.
 */
export async function initGenerator(
  tree: Tree,
  options: NxDotfilesInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath?.trim() || DEFAULT_PLUGIN_PATH;
  const projectName = resolveRootProjectName(tree) ?? '{root-project}';

  registerPlugin(tree, pluginPath);

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — chezmoi/dotbot marker files now infer dotfiles:* targets.`,
    '2. Inspect inferred targets:',
    '   bunx nx show projects',
    `3. Run a target:  bunx nx run ${projectName}:dotfiles:diff  (chezmoi)`,
    `   or:              bunx nx run ${projectName}:dotfiles:install  (dotbot)`,
    '4. chezmoi/dotbot must be installed separately (brew, apt, pip) — the plugin never installs or wraps them.',
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => {};
}

export default initGenerator;
