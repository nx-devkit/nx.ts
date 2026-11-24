import { readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { logger } from '@nx/devkit';
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit';
import { parseLefthookConfig } from './lefthook-config.ts';
import type { NxDevkitGitHooksOptions } from './types.ts';

const PLUGIN_NAME = '@nx-devkit/git-hooks';

/**
 * Git-hook manager configs the plugin reacts to — lefthook
 * (`lefthook.y*ml` / `.lefthook.y*ml`) and pre-commit
 * (`.pre-commit-config.yaml`).
 */
export const HOOKS_GLOB =
  '**/{lefthook.yml,lefthook.yaml,.lefthook.yml,.lefthook.yaml,.pre-commit-config.yaml}';

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isLefthookConfig(fileName: string): boolean {
  return /^\.?lefthook\.ya?ml$/.test(fileName);
}

function shouldSkipDir(projectRoot: string, workspaceRoot: string): boolean {
  const rel = relative(workspaceRoot, resolve(workspaceRoot, projectRoot || '.'));
  if (rel === '') return false;
  const segments = rel.split(/[\\/]/);
  return segments.includes('..') || segments.includes('node_modules');
}

/**
 * Hook names declared by one lefthook config file, or null when the file
 * cannot be read or parsed — a broken config must not break the project
 * graph, so the caller warns and simply gets no hook targets from it.
 */
function readLefthookHooks(absPath: string, configFile: string): string[] | null {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    logger.warn(`[${PLUGIN_NAME}] Could not read ${configFile} — skipping its hook targets`);
    return null;
  }
  try {
    return parseLefthookConfig(text).hooks;
  } catch {
    logger.warn(`[${PLUGIN_NAME}] Could not parse ${configFile} — skipping its hook targets`);
    return null;
  }
}

/**
 * Infer Nx targets from git-hook manager configs.
 *
 * A `lefthook.yml` / `.lefthook.yml` (`.yaml` too) gives one cacheable
 * `<prefix>:<hook-name>` target per hook section (`npx lefthook run
 * <name>`) plus `<prefix>:install` (`npx lefthook install`, never cached).
 * A `.pre-commit-config.yaml` gives a cacheable `<prefix>:run`
 * (`pre-commit run --all-files`) plus `<prefix>:install`
 * (`pre-commit install`). A directory with both kinds merges into a
 * single target set whose `<prefix>:install` installs both managers.
 */
export const createNodesV2: CreateNodesV2<NxDevkitGitHooksOptions> = [
  HOOKS_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot;
    const prefix = options.targetPrefix ?? 'hooks';

    // Group matched files by owning directory — deterministic order.
    const byDir = new Map<string, string[]>();
    for (const configFile of configFiles.map(normalize).sort()) {
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
      const lefthookFiles = sorted.filter((f) => isLefthookConfig(basename(f)));
      const preCommitFiles = sorted.filter((f) => basename(f) === '.pre-commit-config.yaml');

      // Hook names union across every lefthook config in the directory.
      const hookNames = new Set<string>();
      for (const f of lefthookFiles) {
        const names = readLefthookHooks(join(workspaceRoot, f), f);
        for (const name of names ?? []) hookNames.add(name);
      }

      const token = dir === '' ? '{workspaceRoot}' : '{projectRoot}';
      // Every matched config in the dir participates in the hash — an
      // edit redefines the targets.
      const inputs = [
        `${token}/**/*`,
        ...sorted.map((f) => `${token}/${dir === '' ? f : f.slice(dir.length + 1)}`),
      ];

      const targets: Record<string, TargetConfiguration> = Object.create(null);

      for (const name of hookNames) {
        targets[`${prefix}:${name}`] = {
          executor: 'nx:run-commands',
          cache: true,
          inputs,
          options: { command: `npx lefthook run ${name}`, cwd: '{projectRoot}' },
        };
      }

      if (preCommitFiles.length > 0) {
        targets[`${prefix}:run`] = {
          executor: 'nx:run-commands',
          cache: true,
          inputs,
          options: { command: 'pre-commit run --all-files', cwd: '{projectRoot}' },
        };
      }

      // Fixed targets come last — they win over a hook section that
      // happens to share the `install`/`run` name.
      const installCommands: string[] = [];
      if (lefthookFiles.length > 0) installCommands.push('npx lefthook install');
      if (preCommitFiles.length > 0) installCommands.push('pre-commit install');
      if (installCommands.length === 1) {
        targets[`${prefix}:install`] = {
          executor: 'nx:run-commands',
          cache: false,
          options: { command: installCommands[0]!, cwd: '{projectRoot}' },
        };
      } else if (installCommands.length > 1) {
        targets[`${prefix}:install`] = {
          executor: 'nx:run-commands',
          cache: false,
          options: { commands: installCommands, parallel: false, cwd: '{projectRoot}' },
        };
      }

      // Every matched file is a lefthook or pre-commit config, so at
      // least <prefix>:install is always present here.
      results.push([sorted[0]!, { projects: { [dir]: { root: dir, targets } } }]);
    }

    return results;
  },
];

const plugin: { name: string; createNodesV2: typeof createNodesV2 } = {
  name: PLUGIN_NAME,
  createNodesV2,
};
export default plugin;
