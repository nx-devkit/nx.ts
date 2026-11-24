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
export { globMatch, globMatchAsync, globFilesAsync, globToRegExp, expandBraces } from './glob.js';
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

/** Single-quote a value for safe embedding in an nx:run-commands shell command. */
function sq(v: string): string {
  return "'" + v.replace(/'/g, "'\\''") + "'";
}

const PLUGIN_SCOPE = 'nx-typescript';

interface PresetProjectCtx {
  relProjectRoot: string;
  absProjectRoot: string;
  projectRoot: string;
  workspaceRoot: string;
  targets: Record<string, TargetConfiguration>;
  targetGroups: Record<string, string[]>;
  technologies: string[];
  tap: boolean;
  coverage: boolean;
  oxlint: boolean;
  eslint: boolean;
  biome: boolean;
  oxfmt: boolean;
  tsdown: boolean;
  testGlob: string;
  specGlob: string;
  testCi: boolean | string;
  ciTargetName: string;
}

async function addTestCiGroup(
  ctx: PresetProjectCtx,
  files: string[],
  command: (file: string) => string,
  inputs: TargetConfiguration['inputs'],
  outputs?: string[],
): Promise<void> {
  if (!ctx.testCi || files.length === 0) return;
  const ci = inferTestCiTargets(ctx.relProjectRoot, {
    ciTargetName: ctx.ciTargetName,
    files,
    command,
    inputs,
    outputs,
    technologies: ctx.technologies.slice(-1),
  });
  Object.assign(ctx.targets, ci.targets);
  ctx.targetGroups['Test (CI)'] = ci.group;
}

// Vitest's default `include` also collects .tsx/.cts/.cjs/.jsx test
// files beyond the preset's testGlob/specGlob defaults — cover them so
// the atomized `test-ci` group does not silently skip tests `test` runs.
// (Files a Vitest config `exclude`s can't be detected statically; a
// custom `test` include/exclude still applies to `vitest run <file>`.)
const TEST_CI_EXTRA_GLOBS = ['**/*.test.{tsx,cts,cjs,jsx}', '**/*.spec.{tsx,cts,cjs,jsx}'];

async function addTestTargets(ctx: PresetProjectCtx): Promise<void> {
  const vitestConfigPath = await findVitestConfig(ctx.projectRoot, ctx.workspaceRoot);
  const ciGlobs = [ctx.testGlob, ctx.specGlob, ...TEST_CI_EXTRA_GLOBS];
  if (vitestConfigPath) {
    const vitestTargets = inferVitestTargets(ctx.relProjectRoot, vitestConfigPath);
    Object.assign(ctx.targets, vitestTargets);
    // Vitest watch mode is a long-running process — `continuous` lets
    // dependents declare it in `dependsOn`; the "Waiting for file
    // changes" line vitest prints after each pass is the ready signal.
    ctx.targets['test:watch'] = {
      ...vitestTargets['test:watch'],
      continuous: true,
      readyWhen: { logMatches: 'Waiting for file changes' },
    };
    ctx.technologies.push('vitest');
    const testFiles = ctx.testCi ? await globFilesAsync(ctx.absProjectRoot, ciGlobs) : [];
    await addTestCiGroup(
      ctx,
      testFiles,
      (file) => `vitest run ${sq(file)}`,
      vitestTargets.test.inputs,
      vitestTargets.test.outputs,
    );
    return;
  }
  // Native runner: `node --test` cannot load .tsx (and the extras above
  // exist only for Vitest), so discovery stays on testGlob/specGlob.
  // When testCi is off only presence matters — globMatchAsync stops at
  // the first match instead of walking the whole tree for a list that
  // would be discarded anyway.
  const nativeGlobs = [ctx.testGlob, ctx.specGlob];
  const discovered = ctx.testCi ? await globFilesAsync(ctx.absProjectRoot, nativeGlobs) : [];
  const hasTestFiles = ctx.testCi
    ? discovered.length > 0
    : (await globMatchAsync(ctx.absProjectRoot, ctx.testGlob)) ||
      (await globMatchAsync(ctx.absProjectRoot, ctx.specGlob));
  if (!hasTestFiles) return;
  const nativeTargets = inferNativeTestTargets(ctx.relProjectRoot, {
    tap: ctx.tap,
    coverage: ctx.coverage,
    testGlob: ctx.testGlob,
    specGlob: ctx.specGlob,
  });
  Object.assign(ctx.targets, nativeTargets);
  ctx.technologies.push('node');
  await addTestCiGroup(
    ctx,
    discovered,
    (file) => `node --test --test-reporter spec ${sq(file)}`,
    nativeTargets.test.inputs,
  );
}

async function addLintTargets(ctx: PresetProjectCtx): Promise<boolean> {
  // Lint-family configs fall back to the workspace root: a root
  // .oxlintrc/eslint.config/biome.json applies lint/format to every
  // project (the tools themselves walk up for config discovery).
  // When the fallback is used, the root config becomes a cache
  // input so edits invalidate the lint/format caches.
  const projectOxlintrc = await findConfigFile(ctx.projectRoot, ctx.workspaceRoot, OXLINTRC_NAMES);
  const oxlintrcPath =
    projectOxlintrc ?? (await findConfigFile('.', ctx.workspaceRoot, OXLINTRC_NAMES));
  const oxlintOwnsLint = ctx.oxlint && oxlintrcPath !== null;
  if (oxlintOwnsLint) {
    ctx.targets.lint = inferOxlintTarget(ctx.relProjectRoot);
    ctx.technologies.push('oxlint');
    if (!projectOxlintrc) {
      ctx.targets.lint.inputs.push('{workspaceRoot}/.oxlintrc.*');
    }
    return true;
  }
  if (!ctx.eslint) return false;
  const projectEslintConfig = await findConfigFile(
    ctx.projectRoot,
    ctx.workspaceRoot,
    ESLINT_CONFIG_NAMES,
  );
  const eslintConfigPath =
    projectEslintConfig ?? (await findConfigFile('.', ctx.workspaceRoot, ESLINT_CONFIG_NAMES));
  if (!eslintConfigPath) return false;
  ctx.targets.lint = inferEslintTarget(ctx.relProjectRoot);
  ctx.technologies.push('eslint');
  if (!projectEslintConfig) {
    ctx.targets.lint.inputs.push('{workspaceRoot}/eslint.config.*');
  }
  return false;
}

async function addOxfmtTargets(ctx: PresetProjectCtx): Promise<boolean> {
  // Format-family configs fall back to the workspace root too — a
  // root .oxfmtrc/biome.json formats every project. oxfmt owns
  // `format`/`format-check` over biome, mirroring the lint
  // precedence where the oxc tool wins (oxlint > eslint > biome).
  const projectOxfmtConfig = ctx.oxfmt
    ? await findConfigFile(ctx.projectRoot, ctx.workspaceRoot, OXFMT_CONFIG_NAMES)
    : null;
  // oxfmt itself walks ancestor dirs for its config — an intermediate
  // `.oxfmtrc.json` in `libs/` covers every project beneath it.
  const oxfmtConfigPath =
    projectOxfmtConfig ??
    (ctx.oxfmt
      ? await findConfigUpwards(ctx.projectRoot, ctx.workspaceRoot, OXFMT_CONFIG_NAMES)
      : null);
  if (oxfmtConfigPath === null) return false;
  const inferred = inferOxfmtTargets(ctx.relProjectRoot);
  if (!projectOxfmtConfig) {
    // The config lives outside the project — track its exact path.
    const configInput = `{workspaceRoot}/${relative(ctx.workspaceRoot, oxfmtConfigPath).replaceAll('\\', '/')}`;
    for (const t of Object.values(inferred)) {
      t.inputs = [...t.inputs, configInput];
    }
  }
  Object.assign(ctx.targets, inferred);
  return true;
}

async function addBiomeTargets(
  ctx: PresetProjectCtx,
  oxlintOwnsLint: boolean,
  oxfmtOwnsFormat: boolean,
): Promise<void> {
  if (!ctx.biome) return;
  const projectBiomeConfig = await findConfigFile(
    ctx.projectRoot,
    ctx.workspaceRoot,
    BIOME_CONFIG_NAMES,
  );
  const biomeConfigPath =
    projectBiomeConfig ?? (await findConfigFile('.', ctx.workspaceRoot, BIOME_CONFIG_NAMES));
  if (!biomeConfigPath) return;
  const biomeProvidesLint = !oxlintOwnsLint && !('lint' in ctx.targets && ctx.targets.lint);
  const inferred = inferBiomeTargets(ctx.relProjectRoot, biomeProvidesLint);
  if (oxfmtOwnsFormat) {
    // oxfmt already claimed the format family — biome can still
    // contribute its lint fallback, nothing more.
    delete inferred.format;
    delete inferred['format-check'];
  }
  ctx.technologies.push('biome');
  if (!projectBiomeConfig) {
    // Copy before extending — inferBiomeTargets shares the
    // module-level BIOME_INPUTS array across targets/projects.
    for (const t of Object.values(inferred)) {
      t.inputs = [...t.inputs, '{workspaceRoot}/biome.json', '{workspaceRoot}/biome.jsonc'];
    }
  }
  Object.assign(ctx.targets, inferred);
}

async function addBuildTargets(ctx: PresetProjectCtx): Promise<void> {
  if (!ctx.tsdown) return;
  const tsdownConfigPath = await findConfigFile(
    ctx.projectRoot,
    ctx.workspaceRoot,
    TSDOWN_CONFIG_NAMES,
  );
  if (
    tsdownConfigPath ||
    (await hasConfigFreeTsdownEntry(resolve(ctx.workspaceRoot, ctx.projectRoot)))
  ) {
    ctx.targets.build = inferTsdownBuildTarget(ctx.relProjectRoot);
    ctx.targets['build:watch'] = inferTsdownWatchTarget(ctx.relProjectRoot);
    ctx.technologies.push('tsdown');
  }
}

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

      const ctx: PresetProjectCtx = {
        relProjectRoot,
        absProjectRoot,
        projectRoot,
        workspaceRoot,
        targets,
        targetGroups,
        technologies,
        tap,
        coverage,
        oxlint,
        eslint,
        biome,
        oxfmt,
        tsdown,
        testGlob,
        specGlob,
        testCi,
        ciTargetName,
      };
      await addTestTargets(ctx);
      const oxlintOwnsLint = await addLintTargets(ctx);
      const oxfmtOwnsFormat = await addOxfmtTargets(ctx);
      await addBiomeTargets(ctx, oxlintOwnsLint, oxfmtOwnsFormat);
      await addBuildTargets(ctx);

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
