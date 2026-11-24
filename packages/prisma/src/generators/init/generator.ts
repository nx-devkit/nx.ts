import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { installPeerDeps, registerPlugin, resolveRootProjectName } from '@nx-devkit/internal';

export interface NxPrismaInitOptions {
  pluginPath?: string;
}

const PEER_DEPS: Record<string, string> = { prisma: '^6.0.0 || ^7.0.0' };

const DEFAULT_PLUGIN_PATH = '@nx-devkit/prisma';

export async function initGenerator(
  tree: Tree,
  options: NxPrismaInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath || DEFAULT_PLUGIN_PATH;
  const projectName = resolveRootProjectName(tree) ?? '{root-project}';

  registerPlugin(tree, pluginPath);
  const installDeps = installPeerDeps(tree, PEER_DEPS);

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — projects containing schema.prisma or prisma.config.* now have db targets.`,
    '2. Inspect inferred targets on the project that contains the schema:',
    '   npx nx show project <project>',
    `3. Run a target:  npx nx run <project>:db:generate  (e.g. ${projectName} when the schema sits at the workspace root)`,
    '4. Set DATABASE_URL via the environment (.env is picked up by prisma automatically) — never via CLI args.',
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => installDeps();
}

export default initGenerator;
