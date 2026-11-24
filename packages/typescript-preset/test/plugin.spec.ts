import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NxDevkitTypescriptOptions } from '../src/plugin.js';
import {
  createNodesV2,
  inferEslintTarget,
  inferTypecheckTarget,
  inferVitestTargets,
  isVerbose,
  logDebug,
  resetCachedEnv,
  shouldSkipPath,
} from '../src/plugin.js';

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-devkit-typescript-'));
  return root;
}

function touch(root: string, rel: string): string {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, '{}');
  return abs;
}

type ProjectConfiguration = {
  projects?: Record<
    string,
    {
      targets?: Record<string, unknown>;
      metadata?: { technologies?: string[]; targetGroups?: Record<string, string[]> };
    }
  >;
};
type CreateNodesResultEntry = [string, ProjectConfiguration];
type CreateNodesResult = CreateNodesResultEntry[];

async function callCreateNodes(
  configFiles: string[],
  options: Partial<NxDevkitTypescriptOptions> = {},
  workspaceRoot = '/workspace',
): Promise<CreateNodesResult> {
  const fn = createNodesV2[1];
  const result = await fn(configFiles, options, {
    nxJsonConfiguration: {},
    workspaceRoot,
  });
  return result as CreateNodesResult;
}

describe('shouldSkipPath', () => {
  it('skips the workspace root', async () => {
    expect(shouldSkipPath('/workspace', '/workspace')).toBe(true);
  });

  it('skips paths outside the workspace', async () => {
    expect(shouldSkipPath('/other/project', '/workspace')).toBe(true);
  });

  it('skips paths that traverse upward', async () => {
    expect(shouldSkipPath('/workspace/../escape', '/workspace')).toBe(true);
  });

  it('skips paths that contain node_modules', async () => {
    expect(shouldSkipPath('/workspace/packages/foo/node_modules/x', '/workspace')).toBe(true);
  });

  it('keeps normal project roots', async () => {
    expect(shouldSkipPath('/workspace/packages/foo', '/workspace')).toBe(false);
  });
});

describe('isVerbose / logDebug', () => {
  const originalArgv = process.argv;
  const originalEnv = process.env.NX_VERBOSE_LOGGING;

  beforeEach(() => {
    process.argv = originalArgv.filter((a) => a !== '--verbose');
    delete process.env.NX_VERBOSE_LOGGING;
    resetCachedEnv();
  });

  afterEach(() => {
    process.argv = originalArgv;
    if (originalEnv === undefined) delete process.env.NX_VERBOSE_LOGGING;
    else process.env.NX_VERBOSE_LOGGING = originalEnv;
  });

  it('returns false by default', async () => {
    expect(isVerbose()).toBe(false);
  });

  it('returns true when --verbose is on argv', async () => {
    process.argv = [...originalArgv, '--verbose'];
    expect(isVerbose()).toBe(true);
  });

  it('returns true when NX_VERBOSE_LOGGING=true', async () => {
    process.env.NX_VERBOSE_LOGGING = 'true';
    expect(isVerbose()).toBe(true);
  });

  it('logDebug is a noop when not verbose', async () => {
    delete process.env.NX_VERBOSE_LOGGING;
    process.argv = process.argv.filter((a) => a !== '--verbose');
    expect(isVerbose()).toBe(false);
    // Should not throw; calling it covers the noop branch.
    expect(() => logDebug('nx-typescript', 'silent message')).not.toThrow();
  });
});

describe('inferTypecheckTarget', () => {
  const opts = { tsgo: true, configFile: 'tsconfig.json', clean: false };

  it('builds a tsgo typecheck target by default', async () => {
    const t = inferTypecheckTarget('/w/packages/foo', opts);
    expect(t.executor).toBe('@nx-devkit/typescript:typecheck');
    expect(t.options.tsgo).toBe(true);
    expect(t.options.configFile).toBe('tsconfig.json');
    expect(t.options.clean).toBe(false);
    expect(t.cache).toBe(true);
  });

  it('uses tsc and typescript external dep when tsgo=false', async () => {
    const t = inferTypecheckTarget('/w/packages/foo', {
      tsgo: false,
      configFile: 'tsconfig.json',
      clean: false,
    });
    expect(t.options.tsgo).toBe(false);
    const ext = t.inputs.find((i) => typeof i === 'object') as
      | { externalDependencies: string[] }
      | undefined;
    expect(ext?.externalDependencies).toEqual(['typescript']);
  });

  it('uses @typescript/native when tsgo=true', async () => {
    const t = inferTypecheckTarget('/w/p', opts);
    const ext = t.inputs.find((i) => typeof i === 'object') as
      | { externalDependencies: string[] }
      | undefined;
    expect(ext?.externalDependencies).toEqual(['@typescript/native']);
  });

  it('sets clean=true when clean=true', async () => {
    const t = inferTypecheckTarget('/w/p', {
      tsgo: true,
      configFile: 'tsconfig.json',
      clean: true,
    });
    expect(t.options.clean).toBe(true);
  });

  it('substitutes the configured configFile', async () => {
    const t = inferTypecheckTarget('/w/p', {
      tsgo: true,
      configFile: 'tsconfig.lib.json',
      clean: false,
    });
    expect(t.options.configFile).toBe('tsconfig.lib.json');
    expect(t.inputs).toContain('{projectRoot}/tsconfig.lib.json');
  });

  it('includes shared inputs', async () => {
    const t = inferTypecheckTarget('/w/p', opts);
    expect(t.inputs).toEqual(
      expect.arrayContaining([
        '{projectRoot}/**/*.{ts,tsx,mts,cts,js,jsx,cjs,mjs,json}',
        '{projectRoot}/tsconfig*.json',
        '{projectRoot}/package.json',
        '{workspaceRoot}/tsconfig.base.json',
      ]),
    );
  });

  it('excludes generated outputs from inputs', async () => {
    const t = inferTypecheckTarget('/w/p', opts);
    expect(t.inputs).toEqual(
      expect.arrayContaining(['!{projectRoot}/dist', '!{projectRoot}/coverage']),
    );
  });
});

describe('inferVitestTargets', () => {
  it('produces test, test:watch, and test:coverage targets', async () => {
    const targets = inferVitestTargets('/w/p', 'vitest.config.ts');
    expect(Object.keys(targets).sort()).toEqual(['test', 'test:coverage', 'test:watch']);
  });

  it('test target caches and outputs coverage', async () => {
    const t = inferVitestTargets('/w/p', 'vitest.config.ts').test;
    expect(t.executor).toBe('nx:run-commands');
    expect(t.options.command).toBe('vitest run');
    expect(t.options.cwd).toBe('/w/p');
    expect(t.cache).toBe(true);
    expect(t.outputs).toEqual(['{projectRoot}/coverage']);
    expect(t.dependsOn).toEqual(['^build']);
    expect(t.inputs).toEqual(
      expect.arrayContaining([
        'default',
        '{projectRoot}/vitest.config.ts',
        '{workspaceRoot}/vitest.config.ts',
      ]),
    );
  });

  it('test:watch disables cache', async () => {
    const w = inferVitestTargets('/w/p', 'vitest.config.ts')['test:watch'];
    expect(w.cache).toBe(false);
    expect(w.options.command).toBe('vitest');
  });

  it('test:coverage adds --coverage and outputs', async () => {
    const c = inferVitestTargets('/w/p', 'vitest.config.ts')['test:coverage'];
    expect(c.options.command).toBe('vitest run --coverage');
    expect(c.outputs).toEqual(['{projectRoot}/coverage']);
    expect(c.cache).toBe(true);
  });
});

function firstProject(
  result: CreateNodesResult,
  projectKey: string,
): {
  targets?: Record<string, unknown>;
  metadata?: { technologies?: string[]; targetGroups?: Record<string, string[]> };
} {
  expect(result).toHaveLength(1);
  const entry = result[0];
  if (!entry) throw new Error('expected a result entry');
  const projects = entry[1].projects;
  if (!projects) throw new Error('expected projects');
  const proj = projects[projectKey];
  if (!proj) throw new Error(`expected project ${projectKey}`);
  return proj;
}

describe('createNodesV2 integration', () => {
  it('returns an empty array when no config files match', async () => {
    const result = await callCreateNodes([], {}, '/workspace');
    expect(result).toEqual([]);
  });

  it('infers a typecheck target for a project with tsconfig.json', async () => {
    const root = makeWorkspace();
    try {
      const cfg = touch(root, 'packages/foo/tsconfig.json');
      const result = await callCreateNodes([cfg], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const typecheck = proj.targets?.typecheck;
      expect(typecheck).toBeDefined();
      expect(typecheck?.executor).toBe('@nx-devkit/typescript:typecheck');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('auto-infers a root project when it is the only tsconfig (standalone repo)', async () => {
    const root = makeWorkspace();
    try {
      const cfg = touch(root, 'tsconfig.json');
      const result = await callCreateNodes([cfg], {}, root);
      const proj = firstProject(result, '.');
      expect(proj.targets).toHaveProperty('typecheck');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips the workspace root when nested projects exist', async () => {
    const root = makeWorkspace();
    try {
      const rootCfg = touch(root, 'tsconfig.json');
      const nestedCfg = touch(root, 'packages/foo/tsconfig.json');
      const result = await callCreateNodes([rootCfg, nestedCfg], {}, root);
      expect(result).toHaveLength(1);
      expect(result[0]![1].projects).toHaveProperty('packages/foo');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skipped paths do not count as nested projects for auto-detection', async () => {
    // A stray node_modules tsconfig must not suppress root inference —
    // shouldSkipPath discards it, so it cannot be a "nested project".
    const root = makeWorkspace();
    try {
      const cfg = touch(root, 'tsconfig.json');
      const nmCfg = touch(root, 'node_modules/some-dep/tsconfig.json');
      const result = await callCreateNodes([cfg, nmCfg], {}, root);
      const proj = firstProject(result, '.');
      expect(proj.targets).toHaveProperty('typecheck');
      expect(result).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('respects explicit includeRoot: false in a standalone repo', async () => {
    const root = makeWorkspace();
    try {
      const cfg = touch(root, 'tsconfig.json');
      const result = await callCreateNodes([cfg], { includeRoot: false }, root);
      expect(result).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('respects explicit includeRoot: true alongside nested projects', async () => {
    const root = makeWorkspace();
    try {
      const rootCfg = touch(root, 'tsconfig.json');
      const nestedCfg = touch(root, 'packages/foo/tsconfig.json');
      const result = await callCreateNodes([rootCfg, nestedCfg], { includeRoot: true }, root);
      expect(result).toHaveLength(2);
      const keys = result.map(([, r]) => Object.keys(r.projects ?? {})).flat();
      expect(keys).toContain('.');
      expect(keys).toContain('packages/foo');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('includeRoot does not rescue node_modules or escaping paths', async () => {
    const root = makeWorkspace();
    try {
      const nmCfg = touch(root, 'packages/foo/node_modules/x/tsconfig.json');
      // A config path outside the workspace stays skipped — includeRoot
      // only widens the root itself, never paths escaping it.
      const outsideCfg = join(root, '..', 'outside-escape', 'tsconfig.json');
      const result = await callCreateNodes([nmCfg, outsideCfg], { includeRoot: true }, root);
      expect(result).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('respects options.configFile', async () => {
    const root = makeWorkspace();
    try {
      const cfg = touch(root, 'packages/foo/tsconfig.lib.json');
      const result = await callCreateNodes([cfg], { configFile: 'tsconfig.lib.json' }, root);
      expect(result).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not match tsconfig.json when configFile is tsconfig.lib.json', async () => {
    const root = makeWorkspace();
    try {
      const cfg = touch(root, 'packages/foo/tsconfig.json');
      const result = await callCreateNodes([cfg], { configFile: 'tsconfig.lib.json' }, root);
      expect(result).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('infers test targets when vitest.config.ts coexists with tsconfig.json', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      const vitest = touch(root, 'packages/foo/vitest.config.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.test).toBeDefined();
      expect(proj.targets?.['test:watch']).toBeDefined();
      expect(proj.targets?.['test:coverage']).toBeDefined();
      expect(vitest).toBeTruthy();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not infer test targets when no vitest.config.* exists', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.test).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips paths under node_modules', async () => {
    const root = makeWorkspace();
    try {
      const cfg = touch(root, 'packages/foo/node_modules/bar/tsconfig.json');
      const result = await callCreateNodes([cfg], {}, root);
      expect(result).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Mega-preset: native Node test runner
// ---------------------------------------------------------------------------

describe('native Node test runner inference', () => {
  it('infers test target when test files exist but no vitest config', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/src/foo.test.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.test).toBeDefined();
      const test = proj.targets?.test as Record<string, unknown>;
      expect(test.executor).toBe('nx:run-commands');
      const opts = test.options as Record<string, unknown>;
      expect(opts.command).toContain('node --test');
      expect(opts.command).toContain('--test-reporter spec');
      expect(opts.command).not.toContain('{projectRoot}/');
      expect(opts.cwd).toBe('packages/foo');
      expect(test.cache).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('vitest takes priority over native test runner', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/vitest.config.ts');
      touch(root, 'packages/foo/src/foo.test.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const test = proj.targets?.test as Record<string, unknown>;
      const opts = test.options as Record<string, unknown>;
      expect(opts.command).toBe('vitest run');
      expect(proj.targets?.['test:tap']).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('no test files and no vitest config = no test targets', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.test).toBeUndefined();
      expect(proj.targets?.['test:tap']).toBeUndefined();
      expect(proj.targets?.['test:coverage']).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('infers test:tap target when tap:true', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/src/foo.test.ts');
      const result = await callCreateNodes([ts], { tap: true }, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.['test:tap']).toBeDefined();
      const tap = proj.targets?.['test:tap'] as Record<string, unknown>;
      const opts = tap.options as Record<string, unknown>;
      expect(opts.command).toContain('--test-reporter tap');
      expect(opts.command).toContain('> test-results.tap');
      expect(opts.command).not.toContain('| tee');
      expect(opts.command).not.toContain('{projectRoot}/');
      expect(tap.outputs).toEqual(['{projectRoot}/test-results.tap']);
      expect(tap.cache).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('infers test:coverage target when coverage:true', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/src/foo.test.ts');
      const result = await callCreateNodes([ts], { coverage: true }, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.['test:coverage']).toBeDefined();
      const cov = proj.targets?.['test:coverage'] as Record<string, unknown>;
      const opts = cov.options as Record<string, unknown>;
      expect(opts.command).toContain('--experimental-test-coverage');
      expect(opts.command).not.toContain('{projectRoot}/');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses specGlob to detect spec files', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/src/foo.spec.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.test).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Mega-preset: Oxlint lint delegation
// ---------------------------------------------------------------------------

describe('oxlint lint delegation', () => {
  it('infers lint target when .oxlintrc.json exists', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/.oxlintrc.json');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.lint).toBeDefined();
      const lint = proj.targets?.lint as Record<string, unknown>;
      expect(lint.executor).toBe('nx:run-commands');
      const opts = lint.options as Record<string, unknown>;
      expect(opts.command).toContain('oxlint');
      expect(opts.cwd).toBe('packages/foo');
      expect(lint.cache).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not infer oxlint lint when oxlint:false', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/.oxlintrc.json');
      const result = await callCreateNodes([ts], { oxlint: false }, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.lint).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to a workspace-root .oxlintrc and adds it to cache inputs', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, '.oxlintrc.json');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const lint = proj.targets?.lint as Record<string, unknown> | undefined;
      expect(lint).toBeDefined();
      const opts = lint?.options as Record<string, unknown>;
      expect(opts.command).toContain('oxlint');
      expect(lint?.inputs).toContain('{workspaceRoot}/.oxlintrc.*');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to a workspace-root eslint.config and adds it to cache inputs', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'eslint.config.js');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const lint = proj.targets?.lint as Record<string, unknown> | undefined;
      expect(lint).toBeDefined();
      const opts = lint?.options as Record<string, unknown>;
      expect(opts.command).toContain('eslint');
      expect(lint?.inputs).toContain('{workspaceRoot}/eslint.config.*');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to a workspace-root biome.json for format and adds it to cache inputs', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'biome.json');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const formatCheck = proj.targets?.['format-check'] as Record<string, unknown> | undefined;
      expect(formatCheck).toBeDefined();
      expect(formatCheck?.inputs).toContain('{workspaceRoot}/biome.json');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('infers lint target when .oxlintrc.yaml exists', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/.oxlintrc.yaml');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.lint).toBeDefined();
      const lint = proj.targets?.lint as Record<string, unknown>;
      const opts = lint.options as Record<string, unknown>;
      expect(opts.command).toContain('oxlint');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('infers lint target when .oxlintrc.yml exists', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/.oxlintrc.yml');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.lint).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Mega-preset: ESLint lint delegation
// ---------------------------------------------------------------------------

describe('eslint lint delegation', () => {
  it('inferEslintTarget produces a cached lint target', async () => {
    const t = inferEslintTarget('/w/packages/foo');
    expect(t.executor).toBe('nx:run-commands');
    expect(t.options.command).toBe('eslint .');
    expect(t.options.cwd).toBe('/w/packages/foo');
    expect(t.cache).toBe(true);
    expect(t.inputs).toEqual(
      expect.arrayContaining([
        '{projectRoot}/**/*',
        '{projectRoot}/eslint.config.*',
        '{projectRoot}/package.json',
      ]),
    );
  });

  it('infers lint target when eslint.config.mjs exists (no oxlint)', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/eslint.config.mjs');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.lint).toBeDefined();
      const lint = proj.targets?.lint as Record<string, unknown>;
      const opts = lint.options as Record<string, unknown>;
      expect(opts.command).toContain('eslint');
      expect(opts.command).not.toContain('oxlint');
      expect(opts.command).not.toContain('biome');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('oxlint wins over eslint when both configs exist', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/.oxlintrc.json');
      touch(root, 'packages/foo/eslint.config.mjs');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const lint = proj.targets?.lint as Record<string, unknown>;
      const opts = lint.options as Record<string, unknown>;
      expect(opts.command).toContain('oxlint');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not infer eslint lint when eslint:false', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/eslint.config.mjs');
      const result = await callCreateNodes([ts], { eslint: false }, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.lint).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('eslint wins over biome for lint when both exist', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/eslint.config.mjs');
      touch(root, 'packages/foo/biome.json');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const lint = proj.targets?.lint as Record<string, unknown>;
      const opts = lint.options as Record<string, unknown>;
      expect(opts.command).toContain('eslint');
      expect(opts.command).not.toContain('biome lint');
      // biome still provides format targets
      expect(proj.targets?.format).toBeDefined();
      expect(proj.targets?.['format-check']).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('biome provides lint when neither oxlint nor eslint config exists', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/biome.json');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const lint = proj.targets?.lint as Record<string, unknown>;
      const opts = lint.options as Record<string, unknown>;
      expect(opts.command).toContain('biome lint');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Mega-preset: Biome format/lint delegation
// ---------------------------------------------------------------------------

describe('biome format/lint delegation', () => {
  it('infers format and format-check from biome.json', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/biome.json');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.format).toBeDefined();
      expect(proj.targets?.['format-check']).toBeDefined();
      const fmt = proj.targets?.format as Record<string, unknown>;
      const fmtOpts = fmt.options as Record<string, unknown>;
      expect(fmtOpts.command).toContain('biome format --write');
      expect(fmt.cache).toBe(false);
      const fmtCheck = proj.targets?.['format-check'] as Record<string, unknown>;
      const fcOpts = fmtCheck.options as Record<string, unknown>;
      expect(fcOpts.command).toContain('biome format');
      expect(fcOpts.command).not.toContain('--write');
      expect(fmtCheck.cache).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('biome with oxlintrc = no biome lint (oxlint wins)', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/.oxlintrc.json');
      touch(root, 'packages/foo/biome.json');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const lint = proj.targets?.lint as Record<string, unknown>;
      const opts = lint.options as Record<string, unknown>;
      expect(opts.command).toContain('oxlint');
      expect(opts.command).not.toContain('biome lint');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('oxlint disabled, biome provides lint', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/biome.json');
      const result = await callCreateNodes([ts], { oxlint: false }, root);
      const proj = firstProject(result, 'packages/foo');
      const lint = proj.targets?.lint as Record<string, unknown>;
      const opts = lint.options as Record<string, unknown>;
      expect(opts.command).toContain('biome lint');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Mega-preset: Oxfmt format delegation
// ---------------------------------------------------------------------------

describe('oxfmt format delegation', () => {
  it('infers format and format-check from .oxfmtrc.json', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/.oxfmtrc.json');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const fmt = proj.targets?.format as Record<string, unknown>;
      const fmtOpts = fmt.options as Record<string, unknown>;
      expect(fmtOpts.command).toContain('oxfmt --write');
      expect(fmtOpts.cwd).toBe('packages/foo');
      expect(fmt.cache).toBe(false);
      const fmtCheck = proj.targets?.['format-check'] as Record<string, unknown>;
      const fcOpts = fmtCheck.options as Record<string, unknown>;
      expect(fcOpts.command).toContain('oxfmt --check');
      expect(fmtCheck.cache).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('infers format targets from oxfmt.config.ts', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/oxfmt.config.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.format).toBeDefined();
      expect(proj.targets?.['format-check']).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not infer format targets when oxfmt:false', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/.oxfmtrc.json');
      const result = await callCreateNodes([ts], { oxfmt: false }, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.format).toBeUndefined();
      expect(proj.targets?.['format-check']).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('oxfmt wins over biome for format; biome still provides lint fallback', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/.oxfmtrc.json');
      touch(root, 'packages/foo/biome.json');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const fmt = proj.targets?.format as Record<string, unknown>;
      const fmtOpts = fmt.options as Record<string, unknown>;
      expect(fmtOpts.command).toContain('oxfmt');
      expect(fmtOpts.command).not.toContain('biome');
      const fmtCheck = proj.targets?.['format-check'] as Record<string, unknown>;
      const fcOpts = fmtCheck.options as Record<string, unknown>;
      expect(fcOpts.command).toContain('oxfmt');
      // no oxlint/eslint config — biome keeps its lint fallback
      const lint = proj.targets?.lint as Record<string, unknown>;
      const lintOpts = lint.options as Record<string, unknown>;
      expect(lintOpts.command).toContain('biome lint');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('oxfmt:false lets biome own format when both configs exist', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/.oxfmtrc.json');
      touch(root, 'packages/foo/biome.json');
      const result = await callCreateNodes([ts], { oxfmt: false }, root);
      const proj = firstProject(result, 'packages/foo');
      const fmt = proj.targets?.format as Record<string, unknown>;
      const fmtOpts = fmt.options as Record<string, unknown>;
      expect(fmtOpts.command).toContain('biome format --write');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to a workspace-root .oxfmtrc.json and adds it to cache inputs', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, '.oxfmtrc.json');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const fmtCheck = proj.targets?.['format-check'] as Record<string, unknown> | undefined;
      expect(fmtCheck).toBeDefined();
      expect(fmtCheck?.inputs).toContain('{workspaceRoot}/.oxfmtrc.json');
      // An ancestor config also owns the project: libs/.oxfmtrc.json
      // is tracked via its exact workspace-relative path.
      const sharedRoot = makeWorkspace();
      try {
        const ts2 = touch(sharedRoot, 'libs/foo/tsconfig.json');
        touch(sharedRoot, 'libs/.oxfmtrc.json');
        const res2 = await callCreateNodes([ts2], {}, sharedRoot);
        const proj2 = firstProject(res2, 'libs/foo');
        const fc2 = proj2.targets?.['format-check'] as Record<string, unknown> | undefined;
        expect(fc2).toBeDefined();
        expect(fc2?.inputs).toContain('{workspaceRoot}/libs/.oxfmtrc.json');
      } finally {
        rmSync(sharedRoot, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Mega-preset: Tsdown build delegation
// ---------------------------------------------------------------------------

describe('tsdown build delegation', () => {
  it('infers build target from tsdown.config.ts', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/tsdown.config.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.build).toBeDefined();
      const build = proj.targets?.build as Record<string, unknown>;
      expect(build.executor).toBe('@nx-devkit/typescript:build');
      expect(build.cache).toBe(true);
      expect(build.outputs).toEqual(['{projectRoot}/dist']);
      expect(build.dependsOn).toEqual(['^build']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('infers build:watch target from tsdown.config.ts', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/tsdown.config.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.['build:watch']).toBeDefined();
      const watch = proj.targets?.['build:watch'] as Record<string, unknown>;
      expect(watch.executor).toBe('@nx-devkit/typescript:build');
      const opts = watch.options as Record<string, unknown>;
      expect(opts.watch).toBe(true);
      expect(watch.cache).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not infer build when tsdown:false', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/tsdown.config.ts');
      const result = await callCreateNodes([ts], { tsdown: false }, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.build).toBeUndefined();
      expect(proj.targets?.['build:watch']).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('infers build target from tsdown.config.js', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/tsdown.config.js');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.build).toBeDefined();
      const build = proj.targets?.build as Record<string, unknown>;
      expect(build.executor).toBe('@nx-devkit/typescript:build');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('infers config-free build from publishable package.json + src/index.ts', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      writeFileSync(
        join(root, 'packages/foo/package.json'),
        JSON.stringify({ name: 'foo', exports: { '.': './dist/index.mjs' } }),
      );
      touch(root, 'packages/foo/src/index.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const build = proj.targets?.build as Record<string, unknown>;
      expect(build?.executor).toBe('@nx-devkit/typescript:build');
      expect(proj.targets?.['build:watch']).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('infers config-free build from bin field + src/index.ts', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      writeFileSync(
        join(root, 'packages/foo/package.json'),
        JSON.stringify({ name: 'foo', bin: { foo: './dist/cli.mjs' } }),
      );
      touch(root, 'packages/foo/src/index.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.build).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('infers config-free build from main + files + src/index.ts', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      writeFileSync(
        join(root, 'packages/foo/package.json'),
        JSON.stringify({ name: 'foo', main: './dist/index.cjs', files: ['dist'] }),
      );
      touch(root, 'packages/foo/src/index.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.build).toBeDefined();
      expect(proj.targets?.['build:watch']).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not infer build from src/index.ts without publishable package.json fields', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/package.json');
      touch(root, 'packages/foo/src/index.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.build).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not infer build from package.json exports without src/index.ts', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      writeFileSync(
        join(root, 'packages/foo/package.json'),
        JSON.stringify({ name: 'foo', exports: { '.': './dist/index.mjs' } }),
      );
      touch(root, 'packages/foo/src/foo.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.build).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not infer config-free build when tsdown:false', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      writeFileSync(
        join(root, 'packages/foo/package.json'),
        JSON.stringify({ name: 'foo', exports: { '.': './dist/index.mjs' } }),
      );
      touch(root, 'packages/foo/src/index.ts');
      const result = await callCreateNodes([ts], { tsdown: false }, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.build).toBeUndefined();
      expect(proj.targets?.['build:watch']).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('tsdown.config.ts still wins over package.json inference', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/tsdown.config.ts');
      // Invalid JSON makes the config-free heuristic false, so the
      // assertion proves the explicit config path inferred the target.
      writeFileSync(join(root, 'packages/foo/package.json'), '{');
      touch(root, 'packages/foo/src/index.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.build).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Mega-preset: all targets from one plugin
// ---------------------------------------------------------------------------

describe('mega scenario — all targets from one plugin', () => {
  it('infers typecheck + native test + oxlint + biome format + tsdown build', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/src/foo.test.ts');
      touch(root, 'packages/foo/.oxlintrc.json');
      touch(root, 'packages/foo/biome.json');
      touch(root, 'packages/foo/tsdown.config.ts');
      const result = await callCreateNodes([ts], { tap: true, coverage: true }, root);
      const proj = firstProject(result, 'packages/foo');
      const targets = Object.keys(proj.targets ?? {}).sort();
      expect(targets).toEqual(
        expect.arrayContaining([
          'typecheck',
          'test',
          'test:tap',
          'test:coverage',
          'lint',
          'format',
          'format-check',
          'build',
        ]),
      );
      // oxlint owns lint
      const lint = proj.targets?.lint as Record<string, unknown>;
      const lintOpts = lint.options as Record<string, unknown>;
      expect(lintOpts.command).toContain('oxlint');
      // native test runner (no vitest)
      const test = proj.targets?.test as Record<string, unknown>;
      const testOpts = test.options as Record<string, unknown>;
      expect(testOpts.command).toContain('node --test');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Nx 21+ deepening: continuous targets, atomization, metadata
// ---------------------------------------------------------------------------

describe('continuous targets', () => {
  it('marks build:watch continuous with a readyWhen probe', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/tsdown.config.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const watch = proj.targets?.['build:watch'] as Record<string, unknown>;
      expect(watch.continuous).toBe(true);
      expect(watch.readyWhen).toEqual({ logMatches: 'Build complete' });
      expect(watch.cache).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('marks vitest test:watch continuous', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/vitest.config.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const watch = proj.targets?.['test:watch'] as Record<string, unknown>;
      expect(watch.continuous).toBe(true);
      expect(watch.readyWhen).toEqual({ logMatches: 'Waiting for file changes' });
      expect(watch.cache).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not mark non-watch targets continuous', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/vitest.config.ts');
      touch(root, 'packages/foo/tsdown.config.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      for (const name of ['typecheck', 'test', 'build']) {
        const t = proj.targets?.[name] as Record<string, unknown>;
        expect(t.continuous).toBeUndefined();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('test-ci atomization', () => {
  it('does not infer test-ci targets by default', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/vitest.config.ts');
      touch(root, 'packages/foo/src/a.test.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const names = Object.keys(proj.targets ?? {});
      expect(names.some((n) => n.startsWith('test-ci'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('emits a test-ci group plus one runnable target per test file (vitest)', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/vitest.config.ts');
      touch(root, 'packages/foo/src/a.test.ts');
      touch(root, 'packages/foo/src/deep/b.spec.ts');
      const result = await callCreateNodes([ts], { testCi: true }, root);
      const proj = firstProject(result, 'packages/foo');

      const group = proj.targets?.['test-ci'] as Record<string, unknown>;
      expect(group).toBeDefined();
      expect(group.executor).toBe('nx:noop');
      expect(group.cache).toBe(true);

      const perFileA = proj.targets?.['test-ci--src/a.test.ts'] as Record<string, unknown>;
      const perFileB = proj.targets?.['test-ci--src/deep/b.spec.ts'] as Record<string, unknown>;
      expect(perFileA).toBeDefined();
      expect(perFileB).toBeDefined();

      // Each atomized target is individually runnable.
      for (const [file, t] of [
        ['src/a.test.ts', perFileA],
        ['src/deep/b.spec.ts', perFileB],
      ] as const) {
        expect(t.executor).toBe('nx:run-commands');
        const opts = t.options as Record<string, unknown>;
        expect(opts.command).toContain('vitest run');
        expect(opts.command).toContain(file);
        expect(opts.cwd).toBe('packages/foo');
        expect(t.cache).toBe(true);
        const meta = t.metadata as Record<string, unknown>;
        // Atomizer convention: shards carry no nonAtomizedTarget — the
        // noop group points at the ordinary `test` target it shards.
        expect(meta.nonAtomizedTarget).toBeUndefined();
      }
      const groupMeta = group.metadata as Record<string, unknown>;
      expect(groupMeta.nonAtomizedTarget).toBe('test');

      // The group depends on every atomized target so `nx run test-ci`
      // runs the whole suite, shardable per file under DTE.
      const dependsOn = group.dependsOn as { target: string }[];
      const depTargets = dependsOn.map((d) => d.target).sort();
      expect(depTargets).toEqual(['test-ci--src/a.test.ts', 'test-ci--src/deep/b.spec.ts']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('groups atomized targets under metadata.targetGroups', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/vitest.config.ts');
      touch(root, 'packages/foo/src/a.test.ts');
      const result = await callCreateNodes([ts], { testCi: true }, root);
      const proj = firstProject(result, 'packages/foo');
      const groups = proj.metadata?.targetGroups ?? {};
      const names = Object.values(groups).flat();
      expect(names).toContain('test-ci');
      expect(names).toContain('test-ci--src/a.test.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('honours a custom group name via testCi: "<name>"', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/vitest.config.ts');
      touch(root, 'packages/foo/src/a.test.ts');
      const result = await callCreateNodes([ts], { testCi: 'unit-ci' }, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.['unit-ci']).toBeDefined();
      expect(proj.targets?.['unit-ci--src/a.test.ts']).toBeDefined();
      expect(proj.targets?.['test-ci']).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('atomizes the native Node test runner per file', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/src/a.test.ts');
      touch(root, 'packages/foo/src/b.spec.ts');
      const result = await callCreateNodes([ts], { testCi: true }, root);
      const proj = firstProject(result, 'packages/foo');

      const group = proj.targets?.['test-ci'] as Record<string, unknown>;
      expect(group).toBeDefined();
      expect(group.executor).toBe('nx:noop');

      const perFile = proj.targets?.['test-ci--src/a.test.ts'] as Record<string, unknown>;
      expect(perFile).toBeDefined();
      const opts = perFile.options as Record<string, unknown>;
      expect(opts.command).toContain('node --test');
      expect(opts.command).toContain('src/a.test.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('emits no test-ci group when there are no test files', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/vitest.config.ts');
      const result = await callCreateNodes([ts], { testCi: true }, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.['test-ci']).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('atomizes .tsx/.cts test files Vitest would collect', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/vitest.config.ts');
      touch(root, 'packages/foo/src/a.test.tsx');
      touch(root, 'packages/foo/src/b.spec.cts');
      const result = await callCreateNodes([ts], { testCi: true }, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.['test-ci--src/a.test.tsx']).toBeDefined();
      expect(proj.targets?.['test-ci--src/b.spec.cts']).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not infer a native test target for .tsx files node --test cannot run', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/src/a.test.tsx');
      const result = await callCreateNodes([ts], { testCi: true }, root);
      const proj = firstProject(result, 'packages/foo');
      expect(proj.targets?.test).toBeUndefined();
      expect(proj.targets?.['test-ci']).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('project metadata', () => {
  it('emits metadata.technologies reflecting detected tools', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/vitest.config.ts');
      touch(root, 'packages/foo/.oxlintrc.json');
      touch(root, 'packages/foo/tsdown.config.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const tech = proj.metadata?.technologies ?? [];
      expect(tech).toContain('typescript');
      expect(tech).toContain('vitest');
      expect(tech).toContain('oxlint');
      expect(tech).toContain('tsdown');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('always includes typescript and omits undetected tools', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const tech = proj.metadata?.technologies ?? [];
      expect(tech).toEqual(['typescript']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('targetDefaults audit — inputs/outputs completeness', () => {
  it('typecheck hashes tsconfig variants and excludes build outputs', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const typecheck = proj.targets?.typecheck as Record<string, unknown>;
      const inputs = typecheck.inputs as string[];
      expect(inputs).toContain('{projectRoot}/tsconfig*.json');
      expect(inputs).toContain('!{projectRoot}/dist');
      expect(inputs).toContain('!{projectRoot}/coverage');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('oxlint lint covers the whole project minus generated dirs', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/.oxlintrc.json');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const lint = proj.targets?.lint as Record<string, unknown>;
      const inputs = lint.inputs as string[];
      expect(inputs).toContain('{projectRoot}/**/*');
      expect(inputs).toContain('!{projectRoot}/dist');
      expect(inputs).toContain('!{projectRoot}/node_modules');
      expect(inputs).toContain('!{projectRoot}/coverage');
      expect(inputs).toContain('!{projectRoot}/test-results.tap');
      expect(inputs).toContain('{projectRoot}/.oxlintrc.*');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('native test inputs include project sources via the default named input', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/src/foo.test.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const test = proj.targets?.test as Record<string, unknown>;
      const inputs = test.inputs as string[];
      expect(inputs).toContain('default');
      expect(inputs).toContain('!{projectRoot}/test-results.tap');
      expect(inputs).toContain('!{projectRoot}/coverage');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('tsdown build inputs cover tsconfig variants and the shared base', async () => {
    const root = makeWorkspace();
    try {
      const ts = touch(root, 'packages/foo/tsconfig.json');
      touch(root, 'packages/foo/tsdown.config.ts');
      const result = await callCreateNodes([ts], {}, root);
      const proj = firstProject(result, 'packages/foo');
      const build = proj.targets?.build as Record<string, unknown>;
      const inputs = build.inputs as string[];
      expect(inputs).toContain('{projectRoot}/tsconfig*.json');
      expect(inputs).toContain('{workspaceRoot}/tsconfig*.json');
      expect(build.outputs).toEqual(['{projectRoot}/dist']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
