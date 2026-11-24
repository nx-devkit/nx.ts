import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit';
import { parseDotenvKeys } from './dotenv.ts';
import type { NxDevkitDotenvOptions } from './types.ts';

const PLUGIN_NAME = '@nx-devkit/dotenv';

/** Template files the plugin reacts to — one env:check per owning directory. */
export const DOTENV_GLOB = '**/{.env.example,.env.sample}';

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function shouldSkipDir(projectRoot: string, workspaceRoot: string): boolean {
  const rel = relative(workspaceRoot, resolve(workspaceRoot, projectRoot || '.'));
  if (rel === '') return false;
  const segments = rel.split(/[\\/]/);
  return segments.includes('..') || segments.includes('node_modules');
}

/** Keys a file declares, or none when it cannot be read — never values. */
function readDeclaredKeys(absPath: string): string[] {
  try {
    return parseDotenvKeys(readFileSync(absPath, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Infer `env:check` from `.env.example` / `.env.sample` files.
 *
 * Every matched file contributes its declared keys as `{ env: KEY }`
 * runtime inputs — a required var appearing or disappearing in the
 * environment busts the cache of the check. The sibling `.env` is a file
 * input for the same reason. The check itself runs in the bundled
 * `@nx-devkit/dotenv:check` executor; var values never reach argv, the
 * task hash stores only Nx's env-input digests, and failure output lists
 * names only.
 */
export const createNodesV2: CreateNodesV2<NxDevkitDotenvOptions> = [
  DOTENV_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot;
    const targetName = options.targetName || 'env:check';

    // Group matched files by owning directory — deterministic order.
    const byDir = new Map<string, string[]>();
    for (const raw of configFiles) {
      const configFile = normalize(raw);
      const rawDir = dirname(configFile);
      const dir = rawDir === '.' ? '' : rawDir;
      const list = byDir.get(dir) ?? [];
      list.push(configFile);
      byDir.set(dir, list);
    }

    const results: Array<readonly [string, { projects: Record<string, ProjectConfiguration> }]> =
      [];
    for (const [dir, files] of [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (shouldSkipDir(dir, workspaceRoot)) continue;

      const sorted = files.toSorted((a, b) => a.localeCompare(b));
      const winner = sorted.at(0);
      if (winner === undefined) continue;

      const prefix = dir ? '{projectRoot}' : '{workspaceRoot}';
      const fileInputs = sorted.map((f) => `${prefix}/${dir ? f.slice(dir.length + 1) : f}`);

      // Required vars as env inputs — env changes bust the check's cache.
      const envKeys = new Set<string>();
      for (const file of sorted) {
        for (const key of readDeclaredKeys(join(workspaceRoot, file))) {
          envKeys.add(key);
        }
      }
      const inputs: Array<string | { env: string }> = [
        ...fileInputs,
        `${prefix}/.env`,
        ...[...envKeys].sort().map((env) => ({ env })),
      ];

      const targets: Record<string, TargetConfiguration> = {
        [targetName]: {
          executor: '@nx-devkit/dotenv:check',
          cache: true,
          inputs,
          options: { examples: sorted },
        },
      };

      results.push([winner, { projects: { [dir]: { root: dir, targets } } }]);
    }
    return results;
  },
];

const plugin: { name: string; createNodesV2: typeof createNodesV2 } = {
  name: PLUGIN_NAME,
  createNodesV2,
};
export default plugin;
