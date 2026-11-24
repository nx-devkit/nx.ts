import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { registerPlugin, resolveRootProjectName } from '@nx-devkit/internal';

export interface NxCiLintInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/ci-lint';

export async function initGenerator(
  tree: Tree,
  options: NxCiLintInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath?.trim() || DEFAULT_PLUGIN_PATH;
  const projectName = resolveRootProjectName(tree) ?? '{root-project}';

  registerPlugin(tree, pluginPath);

  // Neither linter can be installed here: zizmor is not on npm at all, and
  // npm's `actionlint` package is a WASM API that does not put the CLI on
  // PATH — the probe would still skip it.
  const checklist = [
    `1. The plugin is registered (${pluginPath}) — the root project now gets a lint-ci target when .github/workflows/ contains workflows.`,
    '2. Install the linters if missing — actionlint via brew/go/scoop or the rhysd download script; zizmor via pipx/cargo/brew. Both are optional: lint-ci skips whichever is not on PATH.',
    '3. Inspect inferred targets:',
    '   bunx nx show projects',
    `4. Run the target:  bunx nx run ${projectName}:lint-ci`,
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => {};
}

export default initGenerator;
