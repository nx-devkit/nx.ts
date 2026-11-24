import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CreateNodesContextV2, TargetConfiguration } from '@nx/devkit';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodesV2 } from './plugin.ts';
import type { NxDevkitGoOptions } from './types.ts';

function makeContext(workspaceRoot: string): CreateNodesContextV2 {
  return {
    workspaceRoot,
    nxJsonConfiguration: {},
    projectGraph: { nodes: {}, dependencies: {} },
  } as unknown as CreateNodesContextV2;
}

const tempRoots: string[] = [];
afterEach(() => {
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function makeWorkspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-go-'));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const GO_MOD = 'module example.com/svc\n\ngo 1.23\n';
const GO_WORK = 'go 1.23\n\nuse (\n\t./svc\n\t./lib\n)\n';

async function createNodes(
  root: string,
  files: string[],
  options: NxDevkitGoOptions = {},
): Promise<Record<string, { targets?: Record<string, TargetConfiguration> }>> {
  const results = await createNodesV2[1](files, options, makeContext(root));
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

function workspaceWithWork(): string {
  return makeWorkspace({
    'go.work': GO_WORK,
    'svc/go.mod': GO_MOD,
    'svc/main.go': 'package main\n',
    'lib/go.mod': 'module example.com/lib\n\ngo 1.23\n',
    'lib/lib.go': 'package lib\n',
  });
}

describe('@nx-devkit/go createNodesV2', () => {
  it('watches go.work, go.mod and .golangci.* files', () => {
    expect(createNodesV2[0]).toBe(
      '**/{go.work,go.mod,.golangci.yml,.golangci.yaml,.golangci.json}',
    );
  });

  it('treats a matched .golangci config as a trigger, not a module marker', async () => {
    const root = makeWorkspace({ 'svc/go.mod': GO_MOD, 'svc/.golangci.yml': '' });
    const projects = await createNodes(root, ['svc/go.mod', 'svc/.golangci.yml']);

    expect(Object.keys(projects)).toEqual(['svc']);
    expect(projects['svc']?.targets?.lint).toBeDefined();
  });

  it('turns every go.work use dir with a go.mod into a module project', async () => {
    const root = workspaceWithWork();
    const projects = await createNodes(root, ['go.work', 'svc/go.mod', 'lib/go.mod']);

    for (const dir of ['svc', 'lib']) {
      const targets = projects[dir]?.targets ?? {};
      expect(targets.build?.options).toMatchObject({
        command: 'go build ./...',
        cwd: '{projectRoot}',
      });
      expect(targets.test?.options).toMatchObject({
        command: 'go test ./...',
        cwd: '{projectRoot}',
      });
      expect(targets.vet?.options).toMatchObject({
        command: 'go vet ./...',
        cwd: '{projectRoot}',
      });
      expect(targets.build?.options).toMatchObject({ env: { GOWORK: join(root, 'go.work') } });
    }
  });

  it('skips the go.work dir itself unless it also has a go.mod', async () => {
    const root = workspaceWithWork();
    const projects = await createNodes(root, ['go.work', 'svc/go.mod', 'lib/go.mod']);

    expect(projects['']).toBeUndefined();
  });

  it('infers a root project when the go.work dir has a go.mod', async () => {
    const root = makeWorkspace({
      'go.work': 'go 1.23\n\nuse (\n\t.\n\t./svc\n)\n',
      'go.mod': GO_MOD,
      'svc/go.mod': GO_MOD,
    });
    const projects = await createNodes(root, ['go.work', 'go.mod', 'svc/go.mod']);

    expect(projects['']?.targets?.build?.options).toMatchObject({
      command: 'go build ./...',
      cwd: '{projectRoot}',
      env: { GOWORK: join(root, 'go.work') },
    });
  });

  it('treats a go.mod dir without go.work as a standalone project', async () => {
    const root = makeWorkspace({ 'svc/go.mod': GO_MOD });
    const projects = await createNodes(root, ['svc/go.mod']);

    const targets = projects['svc']?.targets ?? {};
    expect(targets.build?.options).toMatchObject({
      command: 'go build ./...',
      cwd: '{projectRoot}',
      env: { GOWORK: 'off' },
    });
    expect(targets.build?.cache).toBe(true);
    expect(targets.build?.inputs).toEqual(
      expect.arrayContaining([
        '{projectRoot}/go.mod',
        '{projectRoot}/go.sum',
        '{projectRoot}/**/*',
      ]),
    );
    // standalone — no go.work inputs
    expect(targets.build?.inputs).not.toContain('{workspaceRoot}/go.work');
  });

  it('adds go.work inputs to workspace members', async () => {
    const root = workspaceWithWork();
    const projects = await createNodes(root, ['go.work', 'svc/go.mod', 'lib/go.mod']);

    const inputs = projects['svc']?.targets?.build?.inputs ?? [];
    expect(inputs).toContain('{workspaceRoot}/go.work');
    expect(inputs).toContain('{workspaceRoot}/go.work.sum');
  });

  it('attributes member projects to the go.work file', async () => {
    const root = workspaceWithWork();
    const results = await createNodesV2[1](
      ['go.work', 'svc/go.mod', 'lib/go.mod'],
      {},
      makeContext(root),
    );

    const byFile = new Map(results.map(([file, r]) => [file, Object.keys(r.projects ?? {})]));
    expect(byFile.get('go.work')?.sort()).toEqual(['lib', 'svc']);
    // Claimed go.mod files emit no result of their own.
    expect(byFile.get('svc/go.mod')).toBeUndefined();
    expect(byFile.get('lib/go.mod')).toBeUndefined();
  });

  it('skips a use dir that has no go.mod', async () => {
    const root = makeWorkspace({
      'go.work': 'go 1.23\n\nuse (\n\t./svc\n\t./empty\n)\n',
      'svc/go.mod': GO_MOD,
      'empty/keep.txt': '',
    });
    const projects = await createNodes(root, ['go.work', 'svc/go.mod']);

    expect(projects['empty']).toBeUndefined();
    expect(projects['svc']?.targets?.build).toBeDefined();
  });

  it('mixes workspace members and standalone modules', async () => {
    const root = makeWorkspace({
      'go.work': 'go 1.23\n\nuse ./svc\n',
      'svc/go.mod': GO_MOD,
      'other/go.mod': GO_MOD,
    });
    const projects = await createNodes(root, ['go.work', 'svc/go.mod', 'other/go.mod']);

    expect(projects['svc']?.targets?.build?.inputs).toContain('{workspaceRoot}/go.work');
    expect(projects['other']?.targets?.build).toBeDefined();
    expect(projects['other']?.targets?.build?.inputs).not.toContain('{workspaceRoot}/go.work');
  });

  it('infers lint when a golangci config exists at the workspace root', async () => {
    const root = makeWorkspace({
      'go.work': GO_WORK,
      'svc/go.mod': GO_MOD,
      'lib/go.mod': GO_MOD,
      '.golangci.yml': 'run: {}',
    });
    const projects = await createNodes(root, ['go.work', 'svc/go.mod', 'lib/go.mod']);

    expect(projects['svc']?.targets?.lint?.options).toMatchObject({
      command: 'golangci-lint run ./...',
      cwd: '{projectRoot}',
    });
  });

  it('omits lint entirely when options.lint is false', async () => {
    const root = makeWorkspace({
      '.golangci.yml': '',
      'svc/go.mod': GO_MOD,
    });
    const projects = await createNodes(root, ['svc/go.mod'], { lint: false });

    expect(projects['svc']?.targets?.lint).toBeUndefined();
  });

  it('keeps lint enabled by default', async () => {
    const root = makeWorkspace({
      'svc/.golangci.yml': '',
      'svc/go.mod': GO_MOD,
    });
    const projects = await createNodes(root, ['svc/go.mod'], {});

    expect(projects['svc']?.targets?.lint).toBeDefined();
  });

  it('never puts module paths or env values on argv', async () => {
    const root = workspaceWithWork();
    const results = await createNodesV2[1](
      ['go.work', 'svc/go.mod', 'lib/go.mod'],
      {},
      makeContext(root),
    );
    const serialized = JSON.stringify(results);

    expect(serialized).not.toMatch(/example\.com/);
    for (const [, result] of results) {
      for (const project of Object.values(result.projects ?? {})) {
        for (const target of Object.values(project.targets ?? {})) {
          const options = target.options as Record<string, unknown> | undefined;
          expect(Object.keys(options ?? {}).sort()).toEqual(['command', 'cwd', 'env']);
        }
      }
    }
  });

  it('skips go.mod files inside node_modules and vendor dirs', async () => {
    const root = makeWorkspace({ 'svc/go.mod': GO_MOD });
    const projects = await createNodes(root, [
      'svc/go.mod',
      'node_modules/tool/go.mod',
      'svc/vendor/dep/go.mod',
    ]);

    expect(projects['node_modules/tool']).toBeUndefined();
    expect(projects['svc/vendor/dep']).toBeUndefined();
    expect(projects['svc']?.targets?.build).toBeDefined();
  });

  it('skips config files outside the workspace', async () => {
    const root = makeWorkspace({ 'svc/go.mod': GO_MOD });
    const results = await createNodesV2[1](
      ['../outside/go.mod', 'svc/go.mod'],
      {},
      makeContext(root),
    );
    const dirs = results.flatMap(([, r]) => Object.keys(r.projects ?? {}));

    expect(dirs).toEqual(['svc']);
  });

  it('ignores a broken go.work without failing', async () => {
    const root = makeWorkspace({
      'go.work': '{{{',
      'svc/go.mod': GO_MOD,
    });
    const projects = await createNodes(root, ['go.work', 'svc/go.mod']);

    // The broken go.work claims nothing — svc is a standalone module.
    expect(projects['svc']?.targets?.build).toBeDefined();
    expect(projects['svc']?.targets?.build?.inputs).not.toContain('{workspaceRoot}/go.work');
  });

  it('lets the first go.work claim a contested dir', async () => {
    const root = makeWorkspace({
      'a/go.work': 'go 1.23\n\nuse ../svc\n',
      'b/go.work': 'go 1.23\n\nuse ../svc\n',
      'svc/go.mod': GO_MOD,
    });
    const results = await createNodesV2[1](
      ['a/go.work', 'b/go.work', 'svc/go.mod'],
      {},
      makeContext(root),
    );
    const byFile = new Map(results.map(([f, r]) => [f, Object.keys(r.projects ?? {})]));

    expect(byFile.get('a/go.work')).toEqual(['svc']);
    expect(byFile.get('b/go.work')).toBeUndefined();
  });

  it('produces deterministic output regardless of input order', async () => {
    const root = workspaceWithWork();
    const fwd = await createNodesV2[1](
      ['go.work', 'svc/go.mod', 'lib/go.mod'],
      {},
      makeContext(root),
    );
    const rev = await createNodesV2[1](
      ['lib/go.mod', 'go.work', 'svc/go.mod'],
      {},
      makeContext(root),
    );
    expect(fwd).toEqual(rev);
  });
});
