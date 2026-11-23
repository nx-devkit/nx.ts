import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { installPeerDeps, registerPlugin, resolveRootProjectName } from '@nx-devkit/internal';

export interface NxCiLintInitOptions {
  pluginPath?: string;
}

// zizmor has no npm package — it installs via pip, cargo, or brew — so only
// actionlint can be offered as a devDependency here.
const PEER_DEPS: Record<string, string> = { actionlint: '^2.0.0' };

const DEFAULT_PLUGIN_PATH = '@nx-devkit/ci-lint';

export async function initGenerator(
  tree: Tree,
  options: NxCiLintInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath || DEFAULT_PLUGIN_PATH;
  const projectName = resolveRootProjectName(tree) ?? '{root-project}';

  registerPlugin(tree, pluginPath);
  const installDeps = installPeerDeps(tree, PEER_DEPS);

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — the root project now gets a lint-ci target when .github/workflows/ contains workflows.`,
    `2. Install the linters if missing — actionlint via npm (done above) or brew; zizmor via pipx/cargo/brew. Both are optional: lint-ci skips whichever is not on PATH.`,
    '3. Inspect inferred targets:',
    '   bunx nx show projects',
    `4. Run the target:  bunx nx run ${projectName}:lint-ci`,
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => installDeps();
}

export default initGenerator;
