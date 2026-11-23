import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { installPeerDeps, registerPlugin, resolveRootProjectName } from '@nx-devkit/internal';

export interface NxDepsInitOptions {
  pluginPath?: string;
}

const SYNCPEER_DEPS: Record<string, string> = { syncpack: '^15.0.0' };
const MANYPKG_DEPS: Record<string, string> = { '@manypkg/cli': '^0.24.0' };

function wantsManypkg(tree: Tree): boolean {
  if (tree.exists('.manypkg.json')) return true;
  const pkgRaw = tree.read('package.json');
  if (!pkgRaw) return false;
  try {
    const pkg = JSON.parse(pkgRaw.toString('utf8')) as Record<string, unknown>;
    for (const field of ['dependencies', 'devDependencies']) {
      const deps = pkg[field];
      if (
        typeof deps === 'object' &&
        deps !== null &&
        ('@manypkg/cli' in deps || 'manypkg' in deps)
      ) {
        return true;
      }
    }
  } catch {
    // malformed root package.json — fall back to syncpack-only install
  }
  return false;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/deps';

export async function initGenerator(
  tree: Tree,
  options: NxDepsInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath?.trim() || DEFAULT_PLUGIN_PATH;
  const projectName = resolveRootProjectName(tree) ?? '{root-project}';

  registerPlugin(tree, pluginPath);
  const installDeps = installPeerDeps(tree, {
    ...SYNCPEER_DEPS,
    ...(wantsManypkg(tree) ? MANYPKG_DEPS : {}),
  });

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
