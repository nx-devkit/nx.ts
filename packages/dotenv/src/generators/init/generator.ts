import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { registerPlugin, resolveRootProjectName } from '@nx-devkit/internal';

export interface NxDotenvInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/dotenv';

/**
 * Register the plugin in nx.json. No peer dependency is installed — the
 * env checker is a bundled executor, not an external tool.
 */
export async function initGenerator(
  tree: Tree,
  options: NxDotenvInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath || DEFAULT_PLUGIN_PATH;
  const projectName = resolveRootProjectName(tree) ?? '{root-project}';

  registerPlugin(tree, pluginPath);

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — directories containing .env.example/.env.sample now have an env:check target.`,
    '2. Inspect inferred targets:',
    '   bunx nx show projects',
    `3. Verify required vars:  bunx nx run ${projectName}:env:check`,
    '4. Gate other targets on it via dependsOn — see the package README.',
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => {};
}

export default initGenerator;
