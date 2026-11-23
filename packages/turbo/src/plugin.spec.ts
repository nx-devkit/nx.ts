import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CreateNodesContextV2, TargetConfiguration } from '@nx/devkit';
import { describe, expect, it } from 'vitest';
import { createNodesV2 } from './plugin.ts';

function makeContext(workspaceRoot: string): CreateNodesContextV2 {
  return {
    workspaceRoot,
    nxJsonConfiguration: {},
    projectGraph: { nodes: {}, dependencies: {} },
  } as unknown as CreateNodesContextV2;
}

function makeWorkspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-turbo-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const pkg = (name: string, scripts: Record<string, string> = {}) =>
  JSON.stringify({ name, scripts });

const ROOT_PKG = JSON.stringify({
  name: 'root-app',
  private: true,
  workspaces: ['packages/*'],
  scripts: { format: 'oxfmt .' },
});

const TURBO_V2 = JSON.stringify({
  tasks: {
    build: {
      dependsOn: ['^build'],
      outputs: ['dist/**'],
      inputs: ['src/**'],
    },
    test: { dependsOn: ['build'], cache: false },
    dev: { persistent: true },
    '//#format': {},
    'docs#lint': { outputs: ['.out/**'] },
  },
  globalDependencies: ['tsconfig.base.json'],
  globalEnv: ['GLOBAL_FLAG'],
});

function fixtureWorkspace(): string {
  return makeWorkspace({
    'package.json': ROOT_PKG,
    'turbo.json': TURBO_V2,
    'packages/app/package.json': pkg('app', {
      build: 'tsc -b',
      test: 'vitest run',
      dev: 'vite',
    }),
    'packages/lib/package.json': pkg('lib', { build: 'tsc -b' }),
    'packages/docs/package.json': pkg('docs', { lint: 'eslint .' }),
  });
}

async function createNodes(
  root: string,
  files: string[],
): Promise<Record<string, { targets?: Record<string, TargetConfiguration> }>> {
  const results = await createNodesV2[1](files, {}, makeContext(root));
  const projects: Record<string, { targets?: Record<string, TargetConfiguration> }> = {};
  for (const [, result] of results) {
    for (const [root_, project] of Object.entries(result.projects ?? {})) {
      projects[root_] = {
        ...projects[root_],
        ...project,
        targets: { ...projects[root_]?.targets, ...project.targets },
      };
    }
  }
  return projects;
}

describe('@nx-devkit/turbo createNodesV2', () => {
  it('watches turbo.json files', () => {
    expect(createNodesV2[0]).toBe('**/turbo.json');
  });

  it('infers a task on every package with a matching script', async () => {
    const root = fixtureWorkspace();
    const projects = await createNodes(root, ['turbo.json']);

    expect(projects['packages/app']?.targets?.build).toMatchObject({
      executor: 'nx:run-script',
      options: { script: 'build' },
    });
    expect(projects['packages/lib']?.targets?.build).toMatchObject({
      executor: 'nx:run-script',
    });
    // docs has no build script — no build target
    expect(projects['packages/docs']?.targets?.build).toBeUndefined();
    // lib has no test script — no test target
    expect(projects['packages/lib']?.targets?.test).toBeUndefined();
  });

  it('does not apply plain tasks to the root package', async () => {
    const root = fixtureWorkspace();
    const projects = await createNodes(root, ['turbo.json']);

    // turbo semantics: plain tasks never run on the root package,
    // only //# tasks do.
    expect(projects['']?.targets?.build).toBeUndefined();
  });

  it('infers //# tasks on the root project', async () => {
    const root = fixtureWorkspace();
    const projects = await createNodes(root, ['turbo.json']);

    const format = projects['']?.targets?.format;
    expect(format).toMatchObject({
      executor: 'nx:run-script',
      options: { script: 'format' },
    });
  });

  it('requires the root package.json script for //# tasks', async () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({
        name: 'root-app',
        workspaces: ['packages/*'],
      }),
      'turbo.json': JSON.stringify({ tasks: { '//#format': {} } }),
    });
    const projects = await createNodes(root, ['turbo.json']);

    expect(projects['']?.targets?.format).toBeUndefined();
  });

  it('applies pkg#task overrides only to the named package', async () => {
    const root = fixtureWorkspace();
    const projects = await createNodes(root, ['turbo.json']);

    const lint = projects['packages/docs']?.targets?.lint;
    expect(lint).toMatchObject({
      executor: 'nx:run-script',
      options: { script: 'lint' },
      outputs: ['{projectRoot}/.out/**'],
    });
    expect(projects['packages/app']?.targets?.lint).toBeUndefined();
  });

  it('maps dependsOn forms', async () => {
    const root = fixtureWorkspace();
    const projects = await createNodes(root, ['turbo.json']);

    expect(projects['packages/app']?.targets?.build?.dependsOn).toEqual([
      { target: 'build', dependencies: true },
    ]);
    expect(projects['packages/app']?.targets?.test?.dependsOn).toEqual([{ target: 'build' }]);
  });

  it('folds globals into every inferred target', async () => {
    const root = fixtureWorkspace();
    const projects = await createNodes(root, ['turbo.json']);
    const inputs = projects['packages/app']?.targets?.build?.inputs ?? [];

    expect(inputs).toContain('{projectRoot}/src/**');
    expect(inputs).toContain('{workspaceRoot}/tsconfig.base.json');
    expect(inputs).toContainEqual({ env: 'GLOBAL_FLAG' });
    expect(inputs).toContain('{workspaceRoot}/turbo.json');
  });

  it('marks persistent tasks continuous and uncached', async () => {
    const root = fixtureWorkspace();
    const projects = await createNodes(root, ['turbo.json']);
    const dev = projects['packages/app']?.targets?.dev;

    expect(dev?.continuous).toBe(true);
    expect(dev?.cache).toBe(false);
  });

  it('honours cache: false', async () => {
    const root = fixtureWorkspace();
    const projects = await createNodes(root, ['turbo.json']);

    expect(projects['packages/app']?.targets?.test?.cache).toBe(false);
  });

  it('supports the v1 pipeline key', async () => {
    const root = makeWorkspace({
      'package.json': ROOT_PKG,
      'turbo.json': JSON.stringify({
        pipeline: { build: { dependsOn: ['^build'] } },
      }),
      'packages/app/package.json': pkg('app', { build: 'tsc' }),
    });
    const projects = await createNodes(root, ['turbo.json']);

    expect(projects['packages/app']?.targets?.build).toMatchObject({
      executor: 'nx:run-script',
      dependsOn: [{ target: 'build', dependencies: true }],
    });
  });

  it('prefers tasks over pipeline when both exist', async () => {
    const root = makeWorkspace({
      'package.json': ROOT_PKG,
      'turbo.json': JSON.stringify({
        tasks: { build: {} },
        pipeline: { lint: {} },
      }),
      'packages/app/package.json': pkg('app', {
        build: 'tsc',
        lint: 'eslint .',
      }),
    });
    const projects = await createNodes(root, ['turbo.json']);

    expect(projects['packages/app']?.targets?.build).toBeDefined();
    expect(projects['packages/app']?.targets?.lint).toBeUndefined();
  });

  it('applies a nested turbo.json to its own package only', async () => {
    const root = makeWorkspace({
      'package.json': ROOT_PKG,
      'turbo.json': JSON.stringify({ tasks: { build: {} } }),
      'packages/app/package.json': pkg('app', {
        build: 'tsc',
        e2e: 'playwright test',
      }),
      'packages/app/turbo.json': JSON.stringify({
        extends: ['//'],
        tasks: { e2e: { dependsOn: ['build'], cache: false } },
      }),
      'packages/lib/package.json': pkg('lib', {
        build: 'tsc',
        e2e: 'playwright test',
      }),
    });
    const projects = await createNodes(root, ['turbo.json', 'packages/app/turbo.json']);

    expect(projects['packages/app']?.targets?.e2e).toMatchObject({
      executor: 'nx:run-script',
      options: { script: 'e2e' },
      cache: false,
      dependsOn: [{ target: 'build' }],
    });
    // lib has the script but no nested config defines e2e
    expect(projects['packages/lib']?.targets?.e2e).toBeUndefined();
  });

  it('lets a nested turbo.json override the root-inferred task', async () => {
    const root = makeWorkspace({
      'package.json': ROOT_PKG,
      'turbo.json': JSON.stringify({
        tasks: { build: { cache: true } },
      }),
      'packages/app/package.json': pkg('app', { build: 'tsc' }),
      'packages/app/turbo.json': JSON.stringify({
        extends: ['//'],
        tasks: { build: { cache: false } },
      }),
    });
    const projects = await createNodes(root, ['turbo.json', 'packages/app/turbo.json']);

    expect(projects['packages/app']?.targets?.build?.cache).toBe(false);
  });

  it('skips a turbo.json that cannot be parsed', async () => {
    const root = makeWorkspace({
      'package.json': ROOT_PKG,
      'turbo.json': '{ not json',
      'packages/app/package.json': pkg('app', { build: 'tsc' }),
    });
    const projects = await createNodes(root, ['turbo.json']);

    expect(projects['packages/app']).toBeUndefined();
  });

  it('skips a nested turbo.json in a dir without package.json', async () => {
    const root = makeWorkspace({
      'package.json': ROOT_PKG,
      'turbo.json': JSON.stringify({ tasks: {} }),
      'packages/app/package.json': pkg('app', { build: 'tsc' }),
      'scripts/turbo.json': JSON.stringify({ tasks: { gen: {} } }),
    });
    const results = await createNodesV2[1](
      ['turbo.json', 'scripts/turbo.json'],
      {},
      makeContext(root),
    );
    const projects = results.flatMap(([, r]) => Object.keys(r.projects ?? {}));

    expect(projects).not.toContain('scripts');
  });

  it('ignores turbo.json files under node_modules', async () => {
    const root = makeWorkspace({
      'package.json': ROOT_PKG,
      'turbo.json': JSON.stringify({ tasks: {} }),
      'packages/app/package.json': pkg('app'),
      'node_modules/dep/turbo.json': JSON.stringify({ tasks: { x: {} } }),
    });
    const results = await createNodesV2[1](
      ['turbo.json', 'node_modules/dep/turbo.json'],
      {},
      makeContext(root),
    );
    const projects = results.flatMap(([, r]) => Object.keys(r.projects ?? {}));

    expect(projects).not.toContain('node_modules/dep');
  });
});
