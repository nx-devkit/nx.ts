import { formatFiles, visitNotIgnoredFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { installPeerDeps, registerPlugin, resolveRootProjectName } from '@nx-devkit/internal';

export interface NxDocsInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/docs';

const PEER_VERSIONS: Record<DocsTool, string> = {
  astro: '^4.0.0 || ^5.0.0',
  vitepress: '^1.0.0 || ^2.0.0',
};

type DocsTool = 'astro' | 'vitepress';

/** Peer deps follow the tools actually present in the consumer tree. */
function detectPeerDeps(tree: Tree): Record<string, string> {
  const deps: Record<string, string> = {};
  visitNotIgnoredFiles(tree, '', (filePath) => {
    const normalized = filePath.replace(/\\/g, '/');
    if (/(^|\/)\.vitepress\/config\.[cm]?[jt]s$/.test(normalized)) {
      deps.vitepress = PEER_VERSIONS.vitepress;
    }
    if (/(^|\/)astro\.config\.[cm]?[jt]s$/.test(normalized)) {
      deps.astro = PEER_VERSIONS.astro;
    }
  });
  return deps;
}

export async function initGenerator(
  tree: Tree,
  options: NxDocsInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath || DEFAULT_PLUGIN_PATH;
  const projectName = resolveRootProjectName(tree) ?? '{root-project}';

  registerPlugin(tree, pluginPath);
  const installDeps = installPeerDeps(tree, detectPeerDeps(tree));

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — projects containing .vitepress/config.* or astro.config.* (incl. Starlight) now have docs:dev, docs:build and docs:preview targets.`,
    '2. Inspect inferred targets:',
    '   bunx nx show projects',
    `3. Run a target:  bunx nx run ${projectName}:docs:build`,
    '   Start a dev server:  bunx nx run <project>:docs:dev',
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => installDeps();
}

export default initGenerator;
