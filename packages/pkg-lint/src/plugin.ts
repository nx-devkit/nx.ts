import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit';

export interface NxPkgLintPluginOptions {
  /** Name of the inferred target. Default: "lint-pkg". */
  targetName?: string;
  /** Run `npx publint` as part of the target. Default: true. */
  publint?: boolean;
  /** Run `npx attw --pack` as part of the target. Default: true. */
  attw?: boolean;
}

const PACKAGE_JSON_GLOB = '**/package.json';

interface PackageManifest {
  private?: boolean;
  exports?: unknown;
  bin?: unknown;
  main?: unknown;
  files?: unknown;
}

/**
 * Publishable signal — the same heuristic the typescript preset uses for
 * `build`: `exports`, `bin`, or `main` + `files`. `private: true` vetoes:
 * a private manifest is never published, so packaging lint is meaningless.
 */
export function isPublishableManifest(absPath: string): boolean {
  let contents: string;
  try {
    contents = readFileSync(absPath, 'utf8');
  } catch (error) {
    // A vanished manifest is not publishable; any other fs failure is real and
    // must surface instead of silently suppressing the target.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  try {
    const pkg = JSON.parse(contents) as PackageManifest | null;
    if (typeof pkg !== 'object' || pkg === null) return false;
    if (pkg.private === true) return false;
    return Boolean(pkg.exports || pkg.bin || (pkg.main && pkg.files));
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

function shouldSkipDir(projectRoot: string, workspaceRoot: string): boolean {
  const rel = relative(workspaceRoot, resolve(workspaceRoot, projectRoot || '.'));
  if (rel === '') return false;
  const segments = rel.split(/[\\/]/);
  return segments.includes('..') || segments.includes('node_modules') || segments.includes('.git');
}

export function lintPkgTarget(
  projectRoot: string,
  commands: readonly string[],
): TargetConfiguration {
  const prefix = projectRoot ? '{projectRoot}' : '{workspaceRoot}';
  return {
    executor: 'nx:run-commands',
    cache: true,
    // `attw --pack` packs the real tarball, so dist must exist first and every
    // file npm could pack must bust the cache: the project file tree plus the
    // two dotfiles `**/*` does not match (.npmignore / .gitignore, which npm
    // both honor when selecting packed files).
    dependsOn: ['build'],
    inputs: [
      `${prefix}/package.json`,
      `${prefix}/.npmignore`,
      `${prefix}/.gitignore`,
      `${prefix}/**/*`,
    ],
    options: { commands: [...commands], parallel: false, cwd: prefix },
  };
}

export const createNodesV2: CreateNodesV2<NxPkgLintPluginOptions> = [
  PACKAGE_JSON_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot;
    const targetName = options.targetName ?? 'lint-pkg';

    const commands: string[] = [];
    if (options.publint !== false) commands.push('npx publint');
    if (options.attw !== false) commands.push('npx attw --pack');
    if (commands.length === 0) return [];

    const results: Array<readonly [string, { projects: Record<string, ProjectConfiguration> }]> =
      [];
    for (const configFile of [...configFiles].sort()) {
      const normalized = configFile.replace(/\\/g, '/');
      if (normalized.split('/').pop() !== 'package.json') continue;
      const dir = dirname(normalized).replace(/\\/g, '/');
      const projectRoot = dir === '.' ? '' : dir;
      if (shouldSkipDir(projectRoot, workspaceRoot)) continue;
      if (!isPublishableManifest(resolve(workspaceRoot, normalized))) continue;
      results.push([
        configFile,
        {
          projects: {
            [projectRoot]: {
              root: projectRoot,
              targets: { [targetName]: lintPkgTarget(projectRoot, commands) },
            },
          },
        },
      ]);
    }
    return results;
  },
];

export default createNodesV2;

export const __testing: {
  PACKAGE_JSON_GLOB: typeof PACKAGE_JSON_GLOB;
  shouldSkipDir: typeof shouldSkipDir;
} = {
  PACKAGE_JSON_GLOB: PACKAGE_JSON_GLOB,
  shouldSkipDir: shouldSkipDir,
};
