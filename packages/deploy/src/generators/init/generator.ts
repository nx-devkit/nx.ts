import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { registerPlugin, resolveRootProjectName } from '@nx-devkit/internal';

export interface NxDeployInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/deploy';

export async function initGenerator(
  tree: Tree,
  options: NxDeployInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath || DEFAULT_PLUGIN_PATH;
  const projectName = resolveRootProjectName(tree) ?? '{root-project}';

  registerPlugin(tree, pluginPath);

  // Deploy CLIs are provider-specific and often installed globally
  // (flyctl, netlify-cli) — nothing is auto-installed. The user installs the
  // CLI for whichever provider config their projects contain.
  const checklist = [
    `1. The plugin is registered (${pluginPath}) — projects containing wrangler.toml, fly.toml, vercel.json or netlify.toml now have deploy targets.`,
    '2. Install the provider CLI your projects use (wrangler / flyctl / vercel / netlify-cli) — credentials are read from env vars, never argv.',
    '3. Inspect inferred targets:',
    '   bunx nx show projects',
    `4. Run a target:  bunx nx run ${projectName}:deploy`,
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => {};
}

export default initGenerator;
