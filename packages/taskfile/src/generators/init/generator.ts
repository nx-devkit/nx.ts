import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { registerPlugin } from '@nx-devkit/internal';

export interface NxTaskfileInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/taskfile';

/**
 * Register the plugin in nx.json. No peer dependency is installed — the
 * `task` binary (go-task) is a system tool installed via a package
 * manager, never an npm dep.
 */
export async function initGenerator(
  tree: Tree,
  options: NxTaskfileInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath?.trim() || DEFAULT_PLUGIN_PATH;

  registerPlugin(tree, pluginPath);

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — Taskfile tasks are now Nx targets.`,
    '2. Install the task binary if you have not already:',
    '   https://taskfile.dev/installation/ (brew install go-task, snap, winget, …)',
    '3. Inspect inferred targets:',
    '   bunx nx show projects',
    '4. Run a Taskfile task:  bunx nx run <project>:task:<name>',
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => {};
}

export default initGenerator;
