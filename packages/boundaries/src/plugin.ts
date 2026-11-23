import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { logger, type CreateNodesV2 } from '@nx/devkit';
import { isVerbose, logDebug, shouldSkipPath } from '@nx-devkit/internal';
import { inferTagsFromRoot } from './tags.ts';
import type { NxBoundariesOptions } from './types.ts';

const PLUGIN_NAME = '@nx-devkit/boundaries';

interface PackageInfo {
  name: string;
  tags: string[];
}

function readPackageInfo(packageJsonPath: string, projectRoot: string): PackageInfo {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a workspace package.json matched by the createNodesV2 glob
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
    const nx = pkg.nx as Record<string, unknown> | undefined;
    const explicitName = typeof nx?.name === 'string' ? nx.name : undefined;
    const pkgName = typeof pkg.name === 'string' ? pkg.name : undefined;
    // Same order Nx uses when naming a package.json-anchored project.
    const name = explicitName ?? pkgName ?? basename(projectRoot);
    const tags = Array.isArray(nx?.tags) ? (nx.tags as string[]) : [];
    return { name, tags };
  } catch {
    return { name: basename(projectRoot), tags: [] };
  }
}

const SOURCE_INPUTS = '{projectRoot}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}';

export const createNodesV2: CreateNodesV2<NxBoundariesOptions> = [
  '**/package.json',
  (configFiles, options = {}, context) => {
    const verbose = isVerbose();
    const targetName = options.targetName ?? 'check-boundaries';
    const inference = options.inferTags ?? true;

    const executorOptions: Record<string, unknown> = {
      depConstraints: options.depConstraints ?? [],
      // Pass the resolved intent so target output stays stable across defaults.
      inferTags: options.inferTags ?? true,
    };
    if (options.checkCircularDependencies !== undefined) {
      executorOptions.checkCircularDependencies = options.checkCircularDependencies;
    }
    if (options.format !== undefined) {
      executorOptions.format = options.format;
    }

    const results: [string, { projects: Record<string, unknown> }][] = [];
    const seen = new Set<string>();
    let taggedProjects = 0;

    for (const configFile of configFiles) {
      const normalized = configFile.replace(/\\/g, '/');
      const projectRoot = dirname(normalized);
      if (projectRoot === '.' || shouldSkipPath(projectRoot, context.workspaceRoot)) {
        continue;
      }
      if (seen.has(projectRoot)) {
        continue;
      }
      seen.add(projectRoot);

      const info = readPackageInfo(join(context.workspaceRoot, configFile), projectRoot);
      // Explicit nx.tags always win; inference fills in the untagged case.
      const tags = info.tags.length > 0 ? info.tags : inferTagsFromRoot(projectRoot, inference);
      if (tags.length === 0) {
        // Untagged sources are permissive — a target on them would be a
        // vacuous pass (false green).
        continue;
      }
      taggedProjects += 1;

      results.push([
        configFile,
        {
          projects: {
            [projectRoot]: {
              root: projectRoot,
              // Surface inferred tags on the node so `nx show project` and the
              // project graph reflect them (explicit tags are already merged
              // by Nx itself — do not duplicate).
              ...(info.tags.length === 0 ? { tags } : {}),
              targets: {
                [targetName]: {
                  executor: `${PLUGIN_NAME}:check-boundaries`,
                  cache: true,
                  // Scoped inputs keep the target affected-aware; every other
                  // project's package.json is still an input because tag or
                  // constraint changes anywhere can flip this project's edges.
                  inputs: [
                    SOURCE_INPUTS,
                    '{workspaceRoot}/**/package.json',
                    '{workspaceRoot}/tsconfig*.json',
                    '{workspaceRoot}/nx.json',
                  ],
                  options: {
                    ...executorOptions,
                    project: info.name,
                  },
                },
              },
            },
          },
        },
      ]);
    }

    // The root aggregate stays as the single gate over the whole graph.
    // Without it, affected runs of unrelated projects would skip the check.
    if (taggedProjects === 0) {
      logDebug(PLUGIN_NAME, 'No project carries effective tags — no target inferred');
      return [];
    }

    const rootPkg = configFiles.find((f) => dirname(f.replace(/\\/g, '/')) === '.');
    if (!rootPkg) {
      return results;
    }

    if (verbose) {
      logger.info(
        `[${PLUGIN_NAME}] Inferring ${targetName} on the workspace root and ${taggedProjects} project(s)`,
      );
    }

    results.push([
      rootPkg,
      {
        projects: {
          '.': {
            root: '.',
            targets: {
              [targetName]: {
                executor: `${PLUGIN_NAME}:check-boundaries`,
                cache: true,
                // The check is graph-global: every project source file is an
                // input, or edits would hit a stale cache entry.
                inputs: [
                  '{workspaceRoot}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
                  '{workspaceRoot}/**/package.json',
                  '{workspaceRoot}/tsconfig*.json',
                  '{workspaceRoot}/nx.json',
                ],
                options: executorOptions,
              },
            },
          },
        },
      },
    ]);

    return results;
  },
];

const plugin: { name: string; createNodesV2: typeof createNodesV2 } = {
  createNodesV2,
  name: PLUGIN_NAME,
};
export default plugin;
