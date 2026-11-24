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
  const root = mkdtempSync(join(tmpdir(), 'nx-bazel-'));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const CC_BINARY = 'cc_binary(name = "app", srcs = ["main.cc"])';
const CC_TEST = 'cc_test(name = "app_test", srcs = ["app_test.cc"])';

describe('@nx-devkit/bazel createNodesV2', () => {
  it('triggers on BUILD and bazel workspace marker files', () => {
    expect(createNodesV2[0]).toBe('**/{BUILD,BUILD.bazel,WORKSPACE,WORKSPACE.bazel,MODULE.bazel}');
  });

  it('infers a bazel:build target running bazel build //<pkg>:all', async () => {
    const root = makeWorkspace({
      'WORKSPACE.bazel': '',
      'services/api/BUILD.bazel': CC_BINARY,
    });
    const results = await createNodesV2[1](
      ['WORKSPACE.bazel', 'services/api/BUILD.bazel'],
      {},
      makeContext(root),
    );

    const project = results[0]![1].projects!['services/api']!;
    const target = project.targets!['bazel:build']!;
    expect(target.executor).toBe('nx:run-commands');
    expect(target.options).toEqual({
      command: 'bazel build //services/api:all',
      cwd: '{projectRoot}',
    });
    expect(target.cache).toBe(false);
    expect(target.outputs ?? []).toEqual([]);
  });

  it('adds bazel:test only when the BUILD file declares a *_test rule', async () => {
    const root = makeWorkspace({
      'a/BUILD': `${CC_BINARY}\n${CC_TEST}`,
      'b/BUILD': CC_BINARY,
    });
    const results = await createNodesV2[1](['a/BUILD', 'b/BUILD'], {}, makeContext(root));

    const projects = Object.assign({}, ...results.map(([, r]) => r.projects));
    const aTargets = projects.a!.targets!;
    expect(aTargets['bazel:test']).toBeDefined();
    expect(aTargets['bazel:test']!.options).toEqual({
      command: 'bazel test //a:all',
      cwd: '{projectRoot}',
    });
    expect(aTargets['bazel:test']!.cache).toBe(false);
    expect(aTargets['bazel:test']!.outputs ?? []).toEqual([]);
    expect(projects.b!.targets!['bazel:test']).toBeUndefined();
  });

  it('matches *_test rule names generally (go_test, my_custom_test)', async () => {
    const root = makeWorkspace({
      'x/BUILD.bazel': 'go_test(name = "x_test", srcs = ["x_test.go"])',
      'y/BUILD.bazel': 'my_custom_test(name = "y")',
      'z/BUILD.bazel': 'filegroup(name = "fixtures", srcs = ["foo_test.go"])',
    });
    const results = await createNodesV2[1](
      ['x/BUILD.bazel', 'y/BUILD.bazel', 'z/BUILD.bazel'],
      {},
      makeContext(root),
    );
    const projects = Object.assign({}, ...results.map(([, r]) => r.projects));
    expect(projects.x!.targets!['bazel:test']).toBeDefined();
    expect(projects.y!.targets!['bazel:test']).toBeDefined();
    // foo_test.go is a src, not a rule — no test target.
    expect(projects.z!.targets!['bazel:test']).toBeUndefined();
  });

  it('emits //:all for a BUILD file at the workspace root', async () => {
    const root = makeWorkspace({ BUILD: CC_BINARY });
    const results = await createNodesV2[1](['BUILD'], {}, makeContext(root));

    const project = results[0]![1].projects!['']!;
    expect(project.targets!['bazel:build']!.options).toEqual({
      command: 'bazel build //:all',
      cwd: '{projectRoot}',
    });
  });

  it('computes the bazel package path relative to a nested WORKSPACE marker', async () => {
    const root = makeWorkspace({
      'bazel/WORKSPACE': '',
      'bazel/lib/BUILD': CC_BINARY,
    });
    const results = await createNodesV2[1](
      ['bazel/WORKSPACE', 'bazel/lib/BUILD'],
      {},
      makeContext(root),
    );

    const project = results[0]![1].projects!['bazel/lib']!;
    expect(project.targets!['bazel:build']!.options).toEqual({
      command: 'bazel build //lib:all',
      cwd: '{projectRoot}',
    });
  });

  it('accepts MODULE.bazel as a bazel workspace marker', async () => {
    const root = makeWorkspace({
      'backend/MODULE.bazel': 'module(name = "backend")',
      'backend/svc/BUILD.bazel': CC_BINARY,
    });
    const results = await createNodesV2[1](
      ['backend/MODULE.bazel', 'backend/svc/BUILD.bazel'],
      {},
      makeContext(root),
    );

    const project = results[0]![1].projects!['backend/svc']!;
    expect(project.targets!['bazel:build']!.options).toEqual({
      command: 'bazel build //svc:all',
      cwd: '{projectRoot}',
    });
  });

  it('honors the targetPrefix option', async () => {
    const root = makeWorkspace({ 'a/BUILD': `${CC_BINARY}\n${CC_TEST}` });
    const results = await createNodesV2[1](['a/BUILD'], { targetPrefix: 'ci' }, makeContext(root));

    const targets = results[0]![1].projects!.a!.targets!;
    expect(Object.keys(targets).sort()).toEqual(['ci:build', 'ci:test']);
    expect(targets['bazel:build']).toBeUndefined();
  });

  it('names projects bazel:<relpath> when the dir has no package.json', async () => {
    const root = makeWorkspace({ 'services/api/BUILD.bazel': CC_BINARY });
    const results = await createNodesV2[1](['services/api/BUILD.bazel'], {}, makeContext(root));
    expect(results[0]![1].projects!['services/api']!.name).toBe('bazel:services/api');
  });

  it('prefers the package.json name when the dir is also an npm package', async () => {
    const root = makeWorkspace({
      'services/api/package.json': JSON.stringify({ name: '@acme/api' }),
      'services/api/BUILD': CC_BINARY,
    });
    const results = await createNodesV2[1](['services/api/BUILD'], {}, makeContext(root));
    expect(results[0]![1].projects!['services/api']!.name).toBe('@acme/api');
  });

  it('uses the BUILD file and source globs minus bazel-* as inputs', async () => {
    const root = makeWorkspace({
      WORKSPACE: '',
      'services/api/BUILD.bazel': CC_BINARY,
    });
    const results = await createNodesV2[1](
      ['WORKSPACE', 'services/api/BUILD.bazel'],
      {},
      makeContext(root),
    );
    const inputs = results[0]![1].projects!['services/api']!.targets!['bazel:build']!.inputs!;
    expect(inputs).toContain('{projectRoot}/**');
    expect(inputs).toContain('!{projectRoot}/bazel-bin/**');
    expect(inputs).toContain('!{projectRoot}/bazel-api/**');
    expect(inputs).toContain('{workspaceRoot}/**/*.bzl');
    expect(inputs).toContain('{projectRoot}/BUILD.bazel');
    expect(inputs).toContain('{workspaceRoot}/WORKSPACE');
  });

  it('groups BUILD and BUILD.bazel in one dir into a single project', async () => {
    const root = makeWorkspace({
      'a/BUILD': CC_BINARY,
      'a/BUILD.bazel': CC_TEST,
    });
    const results = await createNodesV2[1](['a/BUILD', 'a/BUILD.bazel'], {}, makeContext(root));
    expect(results).toHaveLength(1);
    const targets = results[0]![1].projects!.a!.targets!;
    expect(Object.keys(targets).sort()).toEqual(['bazel:build', 'bazel:test']);
  });

  it('skips dirs outside the workspace and inside node_modules', async () => {
    const root = makeWorkspace({
      'node_modules/x/BUILD': CC_BINARY,
    });
    const results = await createNodesV2[1](
      ['node_modules/x/BUILD', '../outside/BUILD'],
      {},
      makeContext(root),
    );
    expect(results).toHaveLength(0);
  });

  it('emits no project for marker files without a BUILD file', async () => {
    const root = makeWorkspace({ WORKSPACE: '', 'MODULE.bazel': '' });
    const results = await createNodesV2[1](['WORKSPACE', 'MODULE.bazel'], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });

  it('produces deterministic output regardless of input order', async () => {
    const root = makeWorkspace({
      'a/BUILD': CC_BINARY,
      'b/BUILD': `${CC_BINARY}\n${CC_TEST}`,
    });
    const fwd = await createNodesV2[1](['a/BUILD', 'b/BUILD'], {}, makeContext(root));
    const rev = await createNodesV2[1](['b/BUILD', 'a/BUILD'], {}, makeContext(root));
    expect(fwd).toEqual(rev);
  });
});
