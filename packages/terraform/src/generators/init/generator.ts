import { formatFiles, type GeneratorCallback, type Tree } from '@nx/devkit';
import { registerPlugin, resolveRootProjectName } from '@nx-devkit/internal';

export interface NxTerraformInitOptions {
  pluginPath?: string;
}

const DEFAULT_PLUGIN_PATH = '@nx-devkit/terraform';

/**
 * Register the plugin in nx.json. No peer dependency is installed —
 * terraform/tofu are system binaries, not npm packages.
 */
export async function initGenerator(
  tree: Tree,
  options: NxTerraformInitOptions = {},
): Promise<GeneratorCallback> {
  const pluginPath = options.pluginPath?.trim() || DEFAULT_PLUGIN_PATH;
  const projectName = resolveRootProjectName(tree) ?? '{root-project}';

  registerPlugin(tree, pluginPath);

  const checklist = [
    `1. The plugin is registered (${pluginPath}) — directories containing *.tf files now have tf:fmt, tf:validate, and tf:plan targets.`,
    '2. terraform (or OpenTofu) must be installed and on PATH — it is not an npm package.',
    `   For OpenTofu set plugin options: { "plugin": "${pluginPath}", "options": { "binary": "tofu" } }`,
    '3. Inspect inferred targets:',
    '   bunx nx show projects',
    '4. Run a target:  bunx nx run <module-project>:tf:validate',
    '5. tf:plan needs an initialized module (terraform init) plus provider credentials — supply them via the environment (TF_VAR_*, cloud creds) or .tfvars files, never as target args.',
  ];
  for (const line of checklist) {
    console.log(line);
  }
  await formatFiles(tree);

  return () => {};
}

export default initGenerator;
