import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { logger } from '@nx/devkit';
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit';
import { parseMakefile } from './makefile.ts';
import type { NxDevkitMakeOptions } from './types.ts';

const PLUGIN_NAME = '@nx-devkit/make';

/** Config files the plugin reacts to — a Makefile in any directory. */
export const MAKEFILE_GLOB = '**/Makefile';

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function hasSkippedSegment(rel: string): boolean {
  if (rel === '') return false;
  // `relative` returns an absolute path only when the two ends sit on
  // different Windows drives — the dir is outside the workspace either way.
  if (isAbsolute(rel)) return true;
  const segments = rel.split(/[\\/]/);
  return segments.includes('..') || segments.includes('node_modules');
}

function shouldSkipDir(projectRoot: string, workspaceRoot: string): boolean {
  const abs = resolve(workspaceRoot, projectRoot || '.');
  if (hasSkippedSegment(relative(workspaceRoot, abs))) return true;
  // A symlinked segment can hide a `node_modules` dir or a `..` escape
  // the lexical check cannot see — compare real paths too. Both sides
  // are canonicalized because the workspace root itself may be a link.
  try {
    if (!existsSync(abs)) return false;
    const real = realpathSync(abs);
    return hasSkippedSegment(relative(realpathSync(workspaceRoot), real));
  } catch {
    return false;
  }
}

/**
 * `nx:run-commands` runs from the workspace root, so `-C <dir>` places
 * make in the directory owning the Makefile. Only rule names reach this
 * argument — they are `[A-Za-z0-9_.-]` by construction; the dir is
 * shell-quoted when it leaves the safe charset.
 */
function shellWord(value: string): string {
  return /^[\w./-]+$/.test(value) ? value : `"${value.replace(/["\\$`]/g, '\\$&')}"`;
}

function buildTargets(
  parsed: ReturnType<typeof parseMakefile>,
  dir: string,
  prefix: string,
  cache: boolean,
  inputs: string[],
): Record<string, TargetConfiguration> {
  const targets: Record<string, TargetConfiguration> = {};
  const dirArg = shellWord(dir === '' ? '.' : dir);

  for (const target of parsed.targets.values()) {
    const name = `${prefix}:${target.name}`;
    // No dependsOn: `make <goal>` already runs its own prerequisite DAG,
    // so Nx-level edges would only re-run phony/side-effecting prereqs.
    targets[name] = {
      executor: 'nx:run-commands',
      // Make gives no reliable file-output signal — caching is opt-in.
      cache,
      inputs,
      // `--` keeps option-shaped goal names (`-x`) out of getopt.
      options: { command: `make -C ${dirArg} -- ${target.name}` },
    };
  }
  return targets;
}

/**
 * Infer Nx targets from Makefiles. Every name-shaped rule
 * (`name: prerequisites`) and every `.PHONY`-declared goal becomes a
 * `make:<name>` target that shells out to `make -C <dir> -- <name>` —
 * recipes never appear in the inferred command.
 */
export const createNodesV2: CreateNodesV2<NxDevkitMakeOptions> = [
  MAKEFILE_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot;
    const prefix = options.targetPrefix ?? 'make';
    const cache = options.cache ?? false;

    const results: Array<readonly [string, { projects: Record<string, ProjectConfiguration> }]> =
      [];

    for (const rawConfigFile of [...configFiles].map(normalize).sort()) {
      const rawDir = dirname(rawConfigFile);
      const dir = rawDir === '.' ? '' : rawDir;
      if (dir !== '' && shouldSkipDir(dir, workspaceRoot)) continue;

      let text: string;
      try {
        text = readFileSync(join(workspaceRoot, rawConfigFile), 'utf8');
      } catch {
        // An unreadable Makefile must not break the project graph.
        logger.warn(`[${PLUGIN_NAME}] Could not read ${rawConfigFile} — skipping it`);
        continue;
      }
      const parsed = parseMakefile(text);
      if (parsed.targets.size === 0) continue;

      const token = dir === '' ? '{workspaceRoot}' : '{projectRoot}';
      const makefileInput = dir === '' ? '{workspaceRoot}/Makefile' : '{projectRoot}/Makefile';
      const inputs = [
        makefileInput,
        `${token}/**/*`,
        `!${token}/node_modules/**/*`,
        `!${token}/.git/**/*`,
        `!${token}/dist/**/*`,
        `!${token}/coverage/**/*`,
      ];

      results.push([
        rawConfigFile,
        {
          projects: {
            [dir]: {
              root: dir,
              targets: buildTargets(parsed, dir, prefix, cache, inputs),
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
