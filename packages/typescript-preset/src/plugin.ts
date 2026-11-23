import { basename, dirname, relative, resolve } from 'node:path';
import type { CreateNodesResult, CreateNodesV2, TargetConfiguration } from '@nx/devkit';

import type { NxDevkitTypescriptOptions } from './types.js';
import {
  shouldSkipPath,
  logDebug,
  isVerbose,
  resetCachedEnv,
  mapWithConcurrency,
  inferVitestTargets,
} from '@nx-devkit/internal';
import { globFilesAsync, globMatchAsync } from './glob.js';
import {
  BIOME_CONFIG_NAMES,
  ESLINT_CONFIG_NAMES,
  OXFMT_CONFIG_NAMES,
  OXLINTRC_NAMES,
  TSDOWN_CONFIG_NAMES,
  detectNativeTypescript,
  findConfigFile,
  findVitestConfig,
} from './config.js';
import { inferTypecheckTarget } from './targets/typecheck.js';
import { inferNativeTestTargets } from './targets/native-test.js';
import { inferOxlintTarget, inferEslintTarget } from './targets/lint.js';
import { inferBiomeTargets, inferOxfmtTargets } from './targets/format.js';
import {
  hasConfigFreeTsdownEntry,
  inferTsdownBuildTarget,
  inferTsdownWatchTarget,
} from './targets/build.js';
import { inferTestCiTargets } from './targets/test-ci.js';

// Re-export everything for backward compatibility
export type { NxDevkitTypescriptOptions };
export { shouldSkipPath, isVerbose, resetCachedEnv, logDebug };
export { globMatch, globMatchAsync, globToRegExp, expandBraces } from './glob.js';
export { inferTypecheckTarget } from './targets/typecheck.js';
export { inferVitestTargets } from '@nx-devkit/internal';
export { inferNativeTestTargets } from './targets/native-test.js';
export { inferOxlintTarget, inferEslintTarget } from './targets/lint.js';
export { inferBiomeTargets, inferOxfmtTargets } from './targets/format.js';
export {
  hasConfigFreeTsdownEntry,
  inferTsdownBuildTarget,
  inferTsdownWatchTarget,
} from './targets/build.js';
export { inferTestCiTargets } from './targets/test-ci.js';

const PLUGIN_SCOPE = 'nx-typescript';

export const createNodesV2: CreateNodesV2<NxDevkitTypescriptOptions> = [
  '**/tsconfig*.json',
  async (configFiles, options = {}, context) => {
    const configFileName = options.configFile ?? 'tsconfig.json';
    const tsgo = options.tsgo ?? true;
    const clean = options.clean ?? false;
    const tap = options.tap ?? false;
    const coverage = options.coverage ?? false;
    const oxlint = options.oxlint ?? true;
    const eslint = options.eslint ?? true;
    const biome = options.biome ?? true;
    const oxfmt = options.oxfmt ?? true;
    const tsdown = options.tsdown ?? true;
    const testGlob = options.testGlob ?? '**/*.test.{ts,js,mts,mjs}';
    const specGlob = options.specGlob ?? '**/*.spec.{ts,js,mts,mjs}';
    const testCi = options.testCi ?? false;
    const ciTargetName = typeof testCi === 'string' ? testCi : 'test-ci';
    const workspaceRoot = context.workspaceRoot;

    const filteredConfigFiles = configFiles.filter(
      (configFile) => basename(configFile) === configFileName,
    );

    // Root project semantics: the workspace root is a real project when
    // `includeRoot` is set, or automatically when it is the only config
    // detected (single-package repo). Auto-mode self-corrects — when
    // nested projects appear later, the root is skipped again without
    // any stale flag left in nx.json. An explicit `false` always wins.
    const hasNestedProjects = filteredConfigFiles.some((configFile) => {
      const projectRoot = dirname(configFile);
      // Paths that shouldSkipPath discards (node_modules, outside the
      // workspace) never become projects — they must not count as
      // "nested" either, or a stray node_modules tsconfig would suppress
      // root inference and leave a standalone repo with no project.
      return (
        resolve(workspaceRoot, projectRoot) !== resolve(workspaceRoot) &&
        !shouldSkipPath(projectRoot, workspaceRoot)
      );
    });
    const effectiveIncludeRoot =
      options.includeRoot === true || (options.includeRoot === undefined && !hasNestedProjects);

    logDebug(PLUGIN_SCOPE, `Detected ${filteredConfigFiles.length} ${configFileName} files`);

    // Bound concurrency: each project issues several fs probes and up to
    // two recursive glob scans, so an unbounded Promise.all over every
    // detected tsconfig would flood the fs on a large monorepo.
    const results = await mapWithConcurrency(filteredConfigFiles, 8, async (configFile) => {
      const projectRoot = dirname(configFile);
      const isWorkspaceRoot = resolve(workspaceRoot, projectRoot) === resolve(workspaceRoot);

      // The workspace root is only a project when includeRoot applies
      // (explicit or single-package auto). Other skip reasons
      // (node_modules, escaping the root) still apply regardless.
      if (
        shouldSkipPath(projectRoot, workspaceRoot) &&
        !(effectiveIncludeRoot && isWorkspaceRoot)
      ) {
        logDebug(PLUGIN_SCOPE, `Skipping ${projectRoot}`);
        return null;
      }

      const projectKey = (
        relative(workspaceRoot, resolve(workspaceRoot, projectRoot)) || '.'
      ).replace(/\\/g, '/');

      logDebug(PLUGIN_SCOPE, `Registering targets for ${projectKey}`);

      const relProjectRoot = projectKey;
      const absProjectRoot = resolve(workspaceRoot, projectRoot);
      const technologies: string[] = ['typescript'];
      const targetGroups: Record<string, string[]> = {};

      const nativeDep = await detectNativeTypescript(projectRoot, workspaceRoot);

      const typecheckTarget = inferTypecheckTarget(
        relProjectRoot,
        {
          tsgo,
          configFile: configFileName,
          clean,
        },
        nativeDep,
      );

      const targets: Record<string, TargetConfiguration> = {
        typecheck: typecheckTarget,
      };

      const vitestConfigPath = await findVitestConfig(projectRoot, workspaceRoot);
      if (vitestConfigPath) {
        const vitestTargets = inferVitestTargets(relProjectRoot, vitestConfigPath);
        Object.assign(targets, vitestTargets);
        // Vitest watch mode is a long-running process — `continuous` lets
        // dependents declare it in `dependsOn`; the "Waiting for file
        // changes" line vitest prints after each pass is the ready signal.
        targets['test:watch'] = {
          ...vitestTargets['test:watch'],
          continuous: true,
          readyWhen: { logMatches: 'Waiting for file changes' },
        };
        technologies.push('vitest');
        if (testCi) {
          const testFiles = await globFilesAsync(absProjectRoot, [testGlob, specGlob]);
          if (testFiles.length > 0) {
            const ci = inferTestCiTargets(relProjectRoot, {
              ciTargetName,
              files: testFiles,
              command: (file) => `vitest run "${file}"`,
              inputs: vitestTargets.test.inputs,
              outputs: vitestTargets.test.outputs,
              technologies: ['vitest'],
            });
            Object.assign(targets, ci.targets);
            targetGroups['Test (CI)'] = ci.group;
          }
        }
      } else {
        const hasTestFiles =
          (await globMatchAsync(absProjectRoot, testGlob)) ||
          (await globMatchAsync(absProjectRoot, specGlob));
        if (hasTestFiles) {
          const nativeTargets = inferNativeTestTargets(relProjectRoot, {
            tap,
            coverage,
            testGlob,
            specGlob,
          });
          Object.assign(targets, nativeTargets);
          technologies.push('node');
          if (testCi) {
            const testFiles = await globFilesAsync(absProjectRoot, [testGlob, specGlob]);
            if (testFiles.length > 0) {
              const ci = inferTestCiTargets(relProjectRoot, {
                ciTargetName,
                files: testFiles,
                command: (file) => `node --test --test-reporter spec "${file}"`,
                inputs: nativeTargets.test.inputs,
                technologies: ['node'],
              });
              Object.assign(targets, ci.targets);
              targetGroups['Test (CI)'] = ci.group;
            }
          }
        }
      }

      // Lint-family configs fall back to the workspace root: a root
      // .oxlintrc/eslint.config/biome.json applies lint/format to every
      // project (the tools themselves walk up for config discovery).
      // When the fallback is used, the root config becomes a cache
      // input so edits invalidate the lint/format caches.
      const projectOxlintrc = await findConfigFile(projectRoot, workspaceRoot, OXLINTRC_NAMES);
      const oxlintrcPath =
        projectOxlintrc ?? (await findConfigFile('.', workspaceRoot, OXLINTRC_NAMES));
      const oxlintOwnsLint = oxlint && oxlintrcPath !== null;
      if (oxlintOwnsLint) {
        targets.lint = inferOxlintTarget(relProjectRoot);
        technologies.push('oxlint');
        if (!projectOxlintrc) {
          targets.lint.inputs.push('{workspaceRoot}/.oxlintrc.*');
        }
      }

      if (!oxlintOwnsLint && eslint) {
        const projectEslintConfig = await findConfigFile(
          projectRoot,
          workspaceRoot,
          ESLINT_CONFIG_NAMES,
        );
        const eslintConfigPath =
          projectEslintConfig ?? (await findConfigFile('.', workspaceRoot, ESLINT_CONFIG_NAMES));
        if (eslintConfigPath) {
          targets.lint = inferEslintTarget(relProjectRoot);
          technologies.push('eslint');
          if (!projectEslintConfig) {
            targets.lint.inputs.push('{workspaceRoot}/eslint.config.*');
          }
        }
      }

      // Format-family configs fall back to the workspace root too — a
      // root .oxfmtrc/biome.json formats every project. oxfmt owns
      // `format`/`format-check` over biome, mirroring the lint
      // precedence where the oxc tool wins (oxlint > eslint > biome).
      const projectOxfmtConfig = oxfmt
        ? await findConfigFile(projectRoot, workspaceRoot, OXFMT_CONFIG_NAMES)
        : null;
      // oxfmt itself walks ancestor dirs for its config — an intermediate
      // `.oxfmtrc.json` in `libs/` covers every project beneath it.
      const oxfmtConfigPath =
        projectOxfmtConfig ??
        (oxfmt ? await findConfigUpwards(projectRoot, workspaceRoot, OXFMT_CONFIG_NAMES) : null);
      const oxfmtOwnsFormat = oxfmtConfigPath !== null;
      if (oxfmtOwnsFormat) {
        const inferred = inferOxfmtTargets(relProjectRoot);
        if (!projectOxfmtConfig && oxfmtConfigPath !== null) {
          // The config lives outside the project — track its exact path.
          const configInput = `{workspaceRoot}/${relative(workspaceRoot, oxfmtConfigPath).replaceAll('\\', '/')}`;
          for (const t of Object.values(inferred)) {
            t.inputs = [...t.inputs, configInput];
          }
        }
        Object.assign(targets, inferred);
      }

      if (biome) {
        const projectBiomeConfig = await findConfigFile(
          projectRoot,
          workspaceRoot,
          BIOME_CONFIG_NAMES,
        );
        const biomeConfigPath =
          projectBiomeConfig ?? (await findConfigFile('.', workspaceRoot, BIOME_CONFIG_NAMES));
        if (biomeConfigPath) {
          const biomeProvidesLint = !oxlintOwnsLint && !('lint' in targets && targets.lint);
          const inferred = inferBiomeTargets(relProjectRoot, biomeProvidesLint);
          if (oxfmtOwnsFormat) {
            // oxfmt already claimed the format family — biome can still
            // contribute its lint fallback, nothing more.
            delete inferred.format;
            delete inferred['format-check'];
          }
          technologies.push('biome');
          if (!projectBiomeConfig) {
            // Copy before extending — inferBiomeTargets shares the
            // module-level BIOME_INPUTS array across targets/projects.
            for (const t of Object.values(inferred)) {
              t.inputs = [...t.inputs, '{workspaceRoot}/biome.json', '{workspaceRoot}/biome.jsonc'];
            }
          }
          Object.assign(targets, inferred);
        }
      }

      if (tsdown) {
        const tsdownConfigPath = await findConfigFile(
          projectRoot,
          workspaceRoot,
          TSDOWN_CONFIG_NAMES,
        );
        if (
          tsdownConfigPath ||
          (await hasConfigFreeTsdownEntry(resolve(workspaceRoot, projectRoot)))
        ) {
          targets.build = inferTsdownBuildTarget(relProjectRoot);
          targets['build:watch'] = inferTsdownWatchTarget(relProjectRoot);
          technologies.push('tsdown');
        }
      }

      const result: [string, CreateNodesResult] = [
        configFile,
        {
          projects: {
            [projectKey]: {
              targets,
              metadata: {
                technologies,
                ...(Object.keys(targetGroups).length > 0 ? { targetGroups } : {}),
              },
            },
          },
        },
      ];
      return result;
    });

    return results.filter((r): r is [string, CreateNodesResult] => r !== null);
  },
];

/**
 * Search `projectRoot` and each ancestor up to and including the
 * workspace root — mirrors oxfmt's own parent-directory config lookup.
 */
async function findConfigUpwards(
  projectRoot: string,
  workspaceRoot: string,
  names: readonly string[],
): Promise<string | null> {
  const stop = resolve(workspaceRoot);
  let dir = projectRoot;
  for (;;) {
    const found = await findConfigFile(dir, workspaceRoot, names);
    if (found !== null) return found;
    if (resolve(dir) === stop) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
