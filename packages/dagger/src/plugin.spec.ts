import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CreateNodesContextV2 } from 'nx/src/devkit-exports';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodesV2 } from './plugin.ts';

function makeContext(workspaceRoot: string): CreateNodesContextV2 {
  return {
    workspaceRoot,
    nxJsonConfiguration: {},
    turboConfig: undefined,
    projectGraph: { nodes: {}, dependencies: {} },
  } as unknown as CreateNodesContextV2;
}

const tempRoots: string[] = [];
afterEach(() => {
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function makeWorkspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-dagger-'));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const TS_MODULE = JSON.stringify({ name: 'ci', sdk: 'typescript' });

describe('@nx-devkit/dagger createNodesV2', () => {
  it('triggers on dagger.json files', () => {
    expect(createNodesV2[0]).toBe('**/dagger.json');
  });

  it('infers a single dagger:call target when no functions are declared', async () => {
    const root = makeWorkspace({ 'ci/dagger.json': TS_MODULE });
    const results = await createNodesV2[1](['ci/dagger.json'], {}, makeContext(root));

    expect(results).toHaveLength(1);
    const project = results[0]![1].projects!['ci']!;
    expect(Object.keys(project.targets!)).toEqual(['dagger:call']);
    const target = project.targets!['dagger:call']!;
    expect(target.executor).toBe('nx:run-commands');
    expect(target.options).toEqual({ command: 'dagger call', cwd: '{projectRoot}' });
  });

  it('infers one dagger:call:<fn> target per declared function', async () => {
    const root = makeWorkspace({
      'ci/dagger.json': JSON.stringify({
        name: 'ci',
        sdk: 'typescript',
        functions: ['build', 'unitTest'],
      }),
    });
    const results = await createNodesV2[1](['ci/dagger.json'], {}, makeContext(root));

    const targets = results[0]![1].projects!['ci']!.targets!;
    expect(Object.keys(targets).sort()).toEqual(['dagger:call:build', 'dagger:call:unitTest']);
    expect(targets['dagger:call:build']!.options).toEqual({
      command: "dagger call 'build'",
      cwd: '{projectRoot}',
    });
    expect(targets['dagger:call:unitTest']!.options).toEqual({
      command: "dagger call 'unitTest'",
      cwd: '{projectRoot}',
    });
  });

  it('accepts a record-form functions field (keys are the function names)', async () => {
    const root = makeWorkspace({
      'ci/dagger.json': JSON.stringify({ sdk: 'go', functions: { test: {}, publish: {} } }),
    });
    const results = await createNodesV2[1](['ci/dagger.json'], {}, makeContext(root));

    const targets = results[0]![1].projects!['ci']!.targets!;
    expect(Object.keys(targets).sort()).toEqual(['dagger:call:publish', 'dagger:call:test']);
  });

  it('never caches dagger targets but keeps inputs tracked', async () => {
    const root = makeWorkspace({ 'ci/dagger.json': TS_MODULE });
    const results = await createNodesV2[1](['ci/dagger.json'], {}, makeContext(root));

    const target = results[0]![1].projects!['ci']!.targets!['dagger:call']!;
    expect(target.cache).toBe(false);
    expect(target.inputs).toEqual(
      expect.arrayContaining(['{projectRoot}/src/**/*', '{workspaceRoot}/ci/dagger.json']),
    );
  });

  it('defaults to {projectRoot}/src/** for source when sdk is missing', async () => {
    const root = makeWorkspace({ 'ci/dagger.json': JSON.stringify({ name: 'ci' }) });
    const results = await createNodesV2[1](['ci/dagger.json'], {}, makeContext(root));

    const target = results[0]![1].projects!['ci']!.targets!['dagger:call']!;
    expect(target.inputs).toContain('{projectRoot}/src/**/*');
  });

  it('tracks the whole module dir for the go sdk (source lives at module root)', async () => {
    const root = makeWorkspace({ 'ci/dagger.json': JSON.stringify({ sdk: 'go' }) });
    const results = await createNodesV2[1](['ci/dagger.json'], {}, makeContext(root));

    const target = results[0]![1].projects!['ci']!.targets!['dagger:call']!;
    expect(target.inputs).toContain('{projectRoot}/**/*');
  });

  it('honors a declared source directory', async () => {
    const root = makeWorkspace({
      'ci/dagger.json': JSON.stringify({ sdk: 'typescript', source: './lib' }),
    });
    const results = await createNodesV2[1](['ci/dagger.json'], {}, makeContext(root));

    const target = results[0]![1].projects!['ci']!.targets!['dagger:call']!;
    expect(target.inputs).toContain('{projectRoot}/lib/**/*');
    expect(target.inputs).not.toContain('{projectRoot}/src/**/*');
  });

  it('honors a declared source file (sdk entry point)', async () => {
    const root = makeWorkspace({
      'ci/dagger.json': JSON.stringify({ sdk: 'typescript', source: 'src/main.ts' }),
    });
    const results = await createNodesV2[1](['ci/dagger.json'], {}, makeContext(root));

    const target = results[0]![1].projects!['ci']!.targets!['dagger:call']!;
    expect(target.inputs).toContain('{projectRoot}/src/main.ts');
    expect(target.inputs).not.toContain('{projectRoot}/src/**/*');
  });

  it('honors the targetPrefix option', async () => {
    const root = makeWorkspace({
      'ci/dagger.json': JSON.stringify({ functions: ['build'] }),
    });
    const results = await createNodesV2[1](
      ['ci/dagger.json'],
      { targetPrefix: 'pipeline' },
      makeContext(root),
    );

    const targets = results[0]![1].projects!['ci']!.targets!;
    expect(Object.keys(targets)).toEqual(['pipeline:call:build']);
  });

  it('names the project from dagger.json name when the dir has no package.json', async () => {
    const root = makeWorkspace({ 'mod/dagger.json': JSON.stringify({ name: 'my-module' }) });
    const results = await createNodesV2[1](['mod/dagger.json'], {}, makeContext(root));

    expect(results[0]![1].projects!['mod']!.name).toBe('my-module');
  });

  it('does not override the project name when a package.json exists', async () => {
    const root = makeWorkspace({
      'mod/dagger.json': JSON.stringify({ name: 'my-module' }),
      'mod/package.json': JSON.stringify({ name: '@acme/mod' }),
    });
    const results = await createNodesV2[1](['mod/dagger.json'], {}, makeContext(root));

    expect(results[0]![1].projects!['mod']!.name).toBeUndefined();
  });

  it('infers targets on the root project for a workspace-root dagger.json', async () => {
    const root = makeWorkspace({ 'dagger.json': TS_MODULE });
    const results = await createNodesV2[1](['dagger.json'], {}, makeContext(root));

    expect(results).toHaveLength(1);
    const project = results[0]![1].projects!['']!;
    expect(project.targets!['dagger:call']).toBeDefined();
    expect(project.targets!['dagger:call']!.inputs).toContain('{workspaceRoot}/dagger.json');
  });

  it('warns and skips a broken dagger.json instead of breaking the graph', async () => {
    const root = makeWorkspace({ 'ci/dagger.json': '{ not json' });
    const results = await createNodesV2[1](['ci/dagger.json'], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });

  it('skips dagger.json inside node_modules', async () => {
    const root = makeWorkspace({ 'node_modules/x/dagger.json': TS_MODULE });
    const results = await createNodesV2[1](['node_modules/x/dagger.json'], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });

  it('skips dagger.json escaping the workspace', async () => {
    const root = makeWorkspace();
    const results = await createNodesV2[1](['../outside/dagger.json'], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });

  it('shell-quotes declared function names in the command', async () => {
    const root = makeWorkspace({
      'ci/dagger.json': JSON.stringify({ functions: ["o'clock"] }),
    });
    const results = await createNodesV2[1](['ci/dagger.json'], {}, makeContext(root));

    const targets = results[0]![1].projects!['ci']!.targets!;
    const key = Object.keys(targets)[0]!;
    const command = (targets[key]!.options as { command: string }).command;
    expect(command).toBe("dagger call 'o'\\''clock'");
  });

  it('produces deterministic output regardless of input order', async () => {
    const root = makeWorkspace({
      'a/dagger.json': TS_MODULE,
      'b/dagger.json': TS_MODULE,
    });
    const fwd = await createNodesV2[1](['a/dagger.json', 'b/dagger.json'], {}, makeContext(root));
    const rev = await createNodesV2[1](['b/dagger.json', 'a/dagger.json'], {}, makeContext(root));
    expect(fwd).toEqual(rev);
  });
});
