import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { registerPlugin } from '@nx-devkit/internal';

export interface NxPythonInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/python';

/**
 * Register the plugin in nx.json. No npm peer dependency is installed —
 * pytest/ruff/ty/pyright and the uv/poetry runners are Python tools the
 * consumer installs with their own package manager.
 */
export async function initGenerator(
  tree: Tree,
  options: NxPythonInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath?.trim() || DEFAULT_PLUGIN_PATH;

  registerPlugin(tree, pluginPath);

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — valid project manifests become Nx projects (malformed files are skipped).`,
    '2. Inspect inferred targets:',
    '   bunx nx show projects',
    '3. Run a target declared by a Python project (e.g. bunx nx run <project>:test when pytest is declared).',
    '4. Install the Python tools with your package manager (uv add --dev pytest ruff, poetry add --group dev pytest, …).',
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => {};
}

export default initGenerator;
