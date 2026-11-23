import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit';

// drizzle-kit auto-discovers drizzle.config.* in the working directory.
const CONFIG_GLOB = '**/drizzle.config.{ts,js,mts,mjs,cjs,cts}';

/** Drizzle Kit's `out:` option, workspace-default `drizzle` when unset. */
function readOutDir(configPath: string): string {
  try {
    const match = /\bout\s*:\s*['"`]([^'"`]+)['"`]/.exec(readFileSync(configPath, 'utf8'));
    if (match === null) return 'drizzle';
    // Strip a leading ./ — everything else (nested or absolute-ish) is
    // still emitted under the project cwd by drizzle-kit.
    return match[1]!.replace(/^\.\//, '');
  } catch {
    return 'drizzle';
  }
}

function shouldSkipDir(projectRoot: string, workspaceRoot: string): boolean {
  const rel = relative(workspaceRoot, resolve(workspaceRoot, projectRoot || '.'));
  if (rel === '') return false;
  const segments = rel.split(/[\\/]/);
  return segments.includes('..') || segments.includes('node_modules');
}

/**
 * Credentials (DATABASE_URL & friends) never appear here — commands run
 * through the shell with the inherited environment, so secrets travel via
 * env vars or .env files only, never argv.
 */
export const createNodesV2: CreateNodesV2 = [
  CONFIG_GLOB,
  (configFiles, _options, context) => {
    const workspaceRoot = context.workspaceRoot;

    // One target set per owning directory — the lexically first config wins.
    const byDir = new Map<string, string[]>();
    for (const configFile of [...configFiles].sort()) {
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

      const prefix = dir ? '{projectRoot}' : '{workspaceRoot}';
      // Every drizzle.config in the dir is an input so edits bust the cache.
      const configInputs = sorted.map((f) => `${prefix}/${dir ? f.slice(dir.length + 1) : f}`);
      // `out:` relocates migrations — read it so the declared output and
      // the exclusion match what drizzle-kit will actually write.
      const declaredOut = readOutDir(join(workspaceRoot, winner));
      const inputs = [
        `${prefix}/**/*`,
        // Exclude the migrations output — otherwise the first run
        // poisons the cache key for every later run.
        `!{projectRoot}/${declaredOut}/**/*`,
        ...configInputs,
      ];

      const targets: Record<string, TargetConfiguration> = {
        'db:generate': {
          executor: 'nx:run-commands',
          cache: true,
          inputs,
          outputs: [`{projectRoot}/${declaredOut}`],
          options: { command: 'npx drizzle-kit generate', cwd: '{projectRoot}' },
        },
        'db:check': {
          executor: 'nx:run-commands',
          cache: true,
          inputs,
          options: { command: 'npx drizzle-kit check', cwd: '{projectRoot}' },
        },
        // DB-mutating — never cached. db:check runs first to validate the
        // migrations folder before it is applied.
        'db:migrate': {
          executor: 'nx:run-commands',
          cache: false,
          dependsOn: [{ target: 'db:check', projects: 'self' }],
          options: { command: 'npx drizzle-kit migrate', cwd: '{projectRoot}' },
        },
        'db:push': {
          executor: 'nx:run-commands',
          cache: false,
          options: { command: 'npx drizzle-kit push', cwd: '{projectRoot}' },
        },
        // Long-running dev server — never cached.
        'db:studio': {
          executor: 'nx:run-commands',
          cache: false,
          options: { command: 'npx drizzle-kit studio', cwd: '{projectRoot}' },
        },
      };

      results.push([winner, { projects: { [dir]: { root: dir, targets } } }]);
    }
    return results;
  },
];

export default createNodesV2;
