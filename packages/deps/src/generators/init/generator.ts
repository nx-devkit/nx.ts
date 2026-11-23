import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { installPeerDeps, registerPlugin, resolveRootProjectName } from '@nx-devkit/internal';

export interface NxDepsInitOptions {
  pluginPath?: string;
}

const PEER_DEPS: Record<string, string> = { syncpack: '^15.0.0' };

const DEFAULT_PLUGIN_PATH = '@nx-devkit/deps';

export async function initGenerator(
  tree: Tree,
  options: NxDepsInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath || DEFAULT_PLUGIN_PATH;
  const projectName = resolveRootProjectName(tree) ?? '{root-project}';

  registerPlugin(tree, pluginPath);
  const installDeps = installPeerDeps(tree, PEER_DEPS);

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — workspaces with a syncpack config (or manypkg on the root) now have deps:check targets.`,
    '2. Inspect inferred targets:',
    '   bunx nx show projects',
    `3. Run a target:  bunx nx run ${projectName}:deps:check`,
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => installDeps();
}

export default initGenerator;
