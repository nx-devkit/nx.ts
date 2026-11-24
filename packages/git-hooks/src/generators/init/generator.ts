import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { installPeerDeps, registerPlugin } from '@nx-devkit/internal';

export interface NxGitHooksInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/git-hooks';

/** lefthook ships on npm; pre-commit is a Python tool and is never installed here. */
const LEFTHOOK_PEER: Record<string, string> = { lefthook: '^1.0.0 || ^2.0.0' };

const LEFTHOOK_NAME = /^\.?lefthook\.ya?ml$/;
const PRE_COMMIT_NAME = '.pre-commit-config.yaml';

const baseName = (p: string): string => p.split('/').pop() ?? p;

/**
 * Every file in the tree, recursively — the plugin infers targets for
 * hook configs in ANY directory, so detection must scan the whole
 * workspace, not just the root. node_modules/.git are skipped like the
 * plugin's own directory filter.
 */
function* walkFiles(tree: Tree, dir = ''): Generator<string> {
  for (const child of tree.children(dir)) {
    const path = dir ? `${dir}/${child}` : child;
    if (tree.isFile(path)) {
      yield path;
    } else if (child !== 'node_modules' && child !== '.git') {
      yield* walkFiles(tree, path);
    }
  }
}

export async function initGenerator(
  tree: Tree,
  options: NxGitHooksInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath?.trim() || DEFAULT_PLUGIN_PATH;

  // Configs may live at the root or inside nested project dirs — scan the
  // whole tree with the same filenames the plugin's glob matches.
  let hasLefthook = false;
  let hasPreCommit = false;
  for (const file of walkFiles(tree)) {
    const name = baseName(file);
    if (LEFTHOOK_NAME.test(name)) hasLefthook = true;
    else if (name === PRE_COMMIT_NAME) hasPreCommit = true;
    if (hasLefthook && hasPreCommit) break;
  }

  registerPlugin(tree, pluginPath);
  const installDeps = hasLefthook ? installPeerDeps(tree, LEFTHOOK_PEER) : () => {};

  // Derive the checklist from what was actually detected — not every
  // workspace has lefthook's `pre-commit` section or a pre-commit config.
  const checklist = [
    `1. The plugin is registered (${pluginPath}) — lefthook/pre-commit configs now infer hooks targets.`,
    '2. Inspect inferred targets:  bunx nx show projects',
    '3. Install the git hooks:   bunx nx run-many -t hooks:install',
  ];
  const examples: string[] = [];
  if (hasLefthook) examples.push('hooks:<name> — e.g. hooks:pre-commit (lefthook)');
  if (hasPreCommit) examples.push('hooks:run (pre-commit)');
  checklist.push(
    examples.length > 0
      ? `4. Run a hook:  bunx nx run-many -t ${examples.join('  or  ')}`
      : '4. Add a lefthook.yml or .pre-commit-config.yaml, then run:  bunx nx run-many -t hooks:<name>',
  );
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
