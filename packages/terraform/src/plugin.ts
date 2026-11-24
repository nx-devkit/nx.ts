import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit';

const PLUGIN_NAME = '@nx-devkit/terraform';

/**
 * Plugin options for `@nx-devkit/terraform`.
 *
 * OpenTofu vs Terraform cannot be detected reliably from the filesystem
 * (`.terraform.lock.hcl` exists for both and only appears after `init`),
 * so the binary is an explicit option.
 */
export interface NxTerraformPluginOptions {
  /** CLI binary the targets invoke. Default: "terraform". */
  binary?: 'terraform' | 'tofu';
  /** Target name prefix. Default: "tf" → `tf:fmt`, `tf:validate`, `tf:plan`. */
  targetPrefix?: string;
}

// Any .tf file marks its directory as a Terraform/OpenTofu module.
const TF_GLOB = '**/*.tf';

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Vendored modules (.terraform/), dependencies (node_modules/) and paths
 * escaping the workspace never become projects. The workspace root itself
 * is a valid module dir.
 */
function shouldSkipDir(projectRoot: string, workspaceRoot: string): boolean {
  if (isAbsolute(projectRoot)) return true;
  const rel = relative(workspaceRoot, resolve(workspaceRoot, projectRoot || '.'));
  if (rel === '') return false;
  const segments = rel.split(/[\\/]/);
  return (
    segments.includes('..') || segments.includes('node_modules') || segments.includes('.terraform')
  );
}

function inferModuleTargets(
  binary: 'terraform' | 'tofu',
  prefix: string,
  dir: string,
  inputs: string[],
): Record<string, TargetConfiguration> {
  // Commands run at the workspace root; -chdir scopes each invocation to
  // the module dir (fmt validates that dir non-recursively — matching the
  // one-module-per-directory semantics).
  // Single-quote the module path — spaces and shell metacharacters in
  // directory names must not break or inject into the command.
  const shq = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;
  const at = (args: string): string => `${binary} -chdir=${shq(dir === '' ? '.' : dir)} ${args}`;
  const options = (command: string): { command: string; cwd: string } => ({
    command,
    cwd: '{workspaceRoot}',
  });

  // Credentials and variables travel via the environment only — TF_VAR_*,
  // cloud-provider env (AWS_*, ARM_*, GOOGLE_*), .tfvars files. Nothing is
  // ever interpolated into argv.
  return {
    [`${prefix}:fmt`]: {
      executor: 'nx:run-commands',
      cache: true,
      inputs,
      metadata: {
        description: `Check formatting of the module's *.tf files (${binary} fmt -check — read-only).`,
      },
      options: options(at('fmt -check')),
    },
    [`${prefix}:validate`]: {
      executor: 'nx:run-commands',
      cache: true,
      inputs,
      metadata: {
        description:
          `Validate the module. Runs ${binary} init -backend=false first — validate ` +
          'requires an initialized working directory; a backendless init needs no credentials.',
      },
      options: options(`${at('init -backend=false -input=false')} && ${at('validate')}`),
    },
    // plan talks to real state/providers — it needs credentials via env
    // (TF_VAR_*, provider creds) and a fully initialized module. Never cached.
    [`${prefix}:plan`]: {
      executor: 'nx:run-commands',
      cache: false,
      metadata: {
        description:
          `${binary} plan -input=false. Requires env credentials (TF_VAR_*, ` +
          'cloud-provider env) and a normally initialized module — never cached.',
      },
      options: options(at('plan -input=false')),
    },
  };
}

export const createNodesV2: CreateNodesV2<NxTerraformPluginOptions> = [
  TF_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot;
    const binary = options.binary ?? 'terraform';
    const prefix = options.targetPrefix ?? 'tf';

    // Group by owning directory — a dir with any .tf file is one module.
    const byDir = new Map<string, string[]>();
    for (const raw of configFiles) {
      const configFile = normalize(raw);
      const dir = dirname(configFile).replace(/\\/g, '/');
      const key = dir === '.' ? '' : dir;
      const list = byDir.get(key) ?? [];
      list.push(configFile);
      byDir.set(key, list);
    }

    const results: Array<readonly [string, { projects: Record<string, ProjectConfiguration> }]> =
      [];
    for (const [dir, files] of [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (shouldSkipDir(dir, workspaceRoot)) continue;

      const sorted = files.toSorted((a, b) => a.localeCompare(b));
      const winner = sorted.at(0);
      if (winner === undefined) continue;

      const token = dir ? '{projectRoot}' : '{workspaceRoot}';
      const inputs = [
        // recursive: local child modules (./modules/foo) contribute to
        // validate/plan; .terraform/** exclusion keeps vendored copies out.
        `${token}/**/*.tf`,
        `${token}/**/*.tf.json`,
        `${token}/*.tfvars`,
        `${token}/*.tfvars.json`,
        `${token}/.terraform.lock.hcl`,
        // init output and vendored modules must not poison the cache key.
        `!${token}/.terraform/**`,
      ];

      results.push([
        winner,
        {
          projects: {
            [dir]: {
              root: dir,
              targets: inferModuleTargets(binary, prefix, dir, inputs),
              metadata: { technologies: [binary === 'tofu' ? 'opentofu' : 'terraform'] },
            },
          },
        },
      ]);
    }

    return results;
  },
];

const plugin: { name: string; createNodesV2: typeof createNodesV2 } = {
  name: PLUGIN_NAME,
  createNodesV2,
};
export default plugin;
