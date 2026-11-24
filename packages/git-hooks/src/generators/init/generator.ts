import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { installPeerDeps, registerPlugin, resolveRootProjectName } from '@nx-devkit/internal';

export interface NxGitHooksInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/git-hooks';

/** lefthook ships on npm; pre-commit is a Python tool and is never installed here. */
const LEFTHOOK_PEER: Record<string, string> = { lefthook: '^1.0.0 || ^2.0.0' };

const LEFTHOOK_FILE = /(^|\/)\.?lefthook\.ya?ml$/;
const PRE_COMMIT_FILE = /(^|\/)\.pre-commit-config\.yaml$/;

export async function initGenerator(
  tree: Tree,
  options: NxGitHooksInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath || DEFAULT_PLUGIN_PATH;
  const projectName = resolveRootProjectName(tree) ?? '{root-project}';

  const paths = tree.listChanges().map((change) => change.path);
  const hasLefthook = paths.some((p) => LEFTHOOK_FILE.test(p));
  const hasPreCommit = paths.some((p) => PRE_COMMIT_FILE.test(p));

  registerPlugin(tree, pluginPath);
  const installDeps = hasLefthook ? installPeerDeps(tree, LEFTHOOK_PEER) : () => {};

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — lefthook/pre-commit configs now infer hooks targets.`,
    '2. Inspect inferred targets:',
    '   bunx nx show projects',
    `3. Install the git hooks:  bunx nx run ${projectName}:hooks:install`,
    `4. Run a hook:  bunx nx run ${projectName}:hooks:pre-commit  (lefthook) or ${projectName}:hooks:run  (pre-commit)`,
  ];
  if (hasPreCommit) {
    checklist.push(
      '5. pre-commit is a Python tool — install it with pip/brew (`pip install pre-commit`), not npm.',
    );
  }
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => installDeps();
}

export default initGenerator;
