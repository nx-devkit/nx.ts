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
    isLocalPluginPath(pluginPath)
      ? `1. The plugin is registered (${pluginPath}) — a local path registration; keep it in sync manually.`
      : `1. The plugin is registered (${pluginPath}) — install it if missing: bun add -D ${pluginPath}`,
    '2. turbo.json tasks are now Nx targets. Inspect them:',
    '   bunx nx show projects',
    '3. Run the task graph just like `turbo run`:',
    '   bunx nx run-many -t <task>   # any task name from turbo.json',
    '4. turbo --filter equivalents: bunx nx run-many -t <task> --projects=<name>',
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => {};
}

/** Relative or absolute paths register a local plugin — nothing to install. */
function isLocalPluginPath(pluginPath: string): boolean {
  return (
    pluginPath.startsWith('.') || pluginPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(pluginPath)
  );
}

export default initGenerator;
