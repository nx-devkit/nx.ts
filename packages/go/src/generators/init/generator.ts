import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { registerPlugin } from '@nx-devkit/internal';

export interface NxGoInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/go';

/**
 * Register the plugin in nx.json. No dependency is installed — `go` and
 * `golangci-lint` are toolchains the consumer installs themselves; the
 * plugin only reads go.work/go.mod and never shells out at inference time.
 */
export async function initGenerator(
  tree: Tree,
  options: NxGoInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath || DEFAULT_PLUGIN_PATH;

  registerPlugin(tree, pluginPath);

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — go.work use dirs and go.mod dirs now have go targets.`,
    '2. Inspect inferred targets:',
    '   bunx nx show projects',
    '3. Run the task graph:',
    '   bunx nx run-many -t build test vet',
    '4. lint requires golangci-lint on PATH and a .golangci.yml/.yaml/.json config.',
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => {};
}

export default initGenerator;
