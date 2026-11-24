import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  const root = mkdtempSync(join(tmpdir(), 'nx-dotfiles-'));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe('@nx-devkit/dotfiles createNodesV2', () => {
  it('triggers on chezmoi and dotbot marker files', () => {
    expect(createNodesV2[0]).toBe('**/{.chezmoiversion,install.conf.yaml,.install.conf.yaml}');
  });

  it('infers the three chezmoi targets on the owning project', async () => {
    const root = makeWorkspace({ 'dotfiles/.chezmoiversion': '1' });
    const results = await createNodesV2[1](['dotfiles/.chezmoiversion'], {}, makeContext(root));

    const project = results[0]![1].projects!.dotfiles!;
    const targets = project.targets!;
    expect(Object.keys(targets).sort()).toEqual([
      'dotfiles:apply',
      'dotfiles:diff',
      'dotfiles:doctor',
    ]);
  });

  it('chezmoi targets run chezmoi diff/apply/doctor and are never cached', async () => {
    const root = makeWorkspace({ 'dotfiles/.chezmoiversion': '1' });
    const results = await createNodesV2[1](['dotfiles/.chezmoiversion'], {}, makeContext(root));
    const targets = results[0]![1].projects!.dotfiles!.targets!;

    expect(targets['dotfiles:diff']!.executor).toBe('nx:run-commands');
    expect(targets['dotfiles:diff']!.options).toEqual({
      command: 'chezmoi --source {projectRoot} diff',
      cwd: '{projectRoot}',
    });
    expect(targets['dotfiles:diff']!.cache).toBe(false);

    expect(targets['dotfiles:apply']!.options).toEqual({
      command: 'chezmoi --source {projectRoot} apply',
      cwd: '{projectRoot}',
    });
    expect(targets['dotfiles:apply']!.cache).toBe(false);

    expect(targets['dotfiles:doctor']!.options).toEqual({
      command: 'chezmoi --source {projectRoot} doctor',
      cwd: '{projectRoot}',
    });
    expect(targets['dotfiles:doctor']!.cache).toBe(false);
  });

  it('infers dotfiles:install for dotbot install.conf.yaml', async () => {
    const root = makeWorkspace({ 'dotfiles/install.conf.yaml': '[]' });
    const results = await createNodesV2[1](['dotfiles/install.conf.yaml'], {}, makeContext(root));

    const targets = results[0]![1].projects!.dotfiles!.targets!;
    expect(Object.keys(targets)).toEqual(['dotfiles:install']);
    expect(targets['dotfiles:install']!.executor).toBe('nx:run-commands');
    expect(targets['dotfiles:install']!.options).toEqual({
      command: 'dotbot -c install.conf.yaml',
      cwd: '{projectRoot}',
    });
    expect(targets['dotfiles:install']!.cache).toBe(false);
  });

  it('prefers ./install when the dotbot launcher script exists', async () => {
    const root = makeWorkspace({
      'dotfiles/install.conf.yaml': '[]',
      'dotfiles/install': '#!/bin/sh\n',
    });
    chmodSync(join(root, 'dotfiles/install'), 0o755);
    const results = await createNodesV2[1](['dotfiles/install.conf.yaml'], {}, makeContext(root));

    const targets = results[0]![1].projects!.dotfiles!.targets!;
    expect(targets['dotfiles:install']!.options).toEqual({
      command: './install',
      cwd: '{projectRoot}',
    });
  });

  it('passes the hidden .install.conf.yaml basename to dotbot -c', async () => {
    const root = makeWorkspace({ 'dotfiles/.install.conf.yaml': '[]' });
    const results = await createNodesV2[1](['dotfiles/.install.conf.yaml'], {}, makeContext(root));

    const targets = results[0]![1].projects!.dotfiles!.targets!;
    expect(targets['dotfiles:install']!.options).toEqual({
      command: 'dotbot -c .install.conf.yaml',
      cwd: '{projectRoot}',
    });
  });

  it('detects chezmoi from any .chezmoi* file present in the directory', async () => {
    // Triggered via install.conf.yaml, but the dir also holds .chezmoiignore —
    // the .chezmoi* presence makes it a chezmoi source dir too.
    const root = makeWorkspace({
      'dotfiles/install.conf.yaml': '[]',
      'dotfiles/.chezmoiignore': '*.log\n',
    });
    const results = await createNodesV2[1](['dotfiles/install.conf.yaml'], {}, makeContext(root));

    const targets = results[0]![1].projects!.dotfiles!.targets!;
    expect(Object.keys(targets).sort()).toEqual([
      'dotfiles:apply',
      'dotfiles:diff',
      'dotfiles:doctor',
      'dotfiles:install',
    ]);
  });

  it('infers targets on the root project for a workspace-root marker', async () => {
    const root = makeWorkspace({ '.chezmoiversion': '1' });
    const results = await createNodesV2[1](['.chezmoiversion'], {}, makeContext(root));

    expect(results).toHaveLength(1);
    const targets = results[0]![1].projects!['']!.targets!;
    expect(targets['dotfiles:apply']).toBeDefined();
  });

  it('groups several markers in one directory into a single target set', async () => {
    const root = makeWorkspace({
      'dotfiles/.chezmoiversion': '1',
      'dotfiles/install.conf.yaml': '[]',
    });
    const results = await createNodesV2[1](
      ['dotfiles/.chezmoiversion', 'dotfiles/install.conf.yaml'],
      {},
      makeContext(root),
    );

    expect(results).toHaveLength(1);
    const targets = results[0]![1].projects!.dotfiles!.targets!;
    expect(Object.keys(targets).sort()).toEqual([
      'dotfiles:apply',
      'dotfiles:diff',
      'dotfiles:doctor',
      'dotfiles:install',
    ]);
  });

  it('emits no dotbot target for a directory without install.conf.yaml', async () => {
    const root = makeWorkspace({ 'dotfiles/.chezmoiversion': '1' });
    const results = await createNodesV2[1](['dotfiles/.chezmoiversion'], {}, makeContext(root));
    const targets = results[0]![1].projects!.dotfiles!.targets!;
    expect(targets['dotfiles:install']).toBeUndefined();
  });

  it('skips markers outside the workspace', async () => {
    const root = makeWorkspace();
    const results = await createNodesV2[1](['../outside/.chezmoiversion'], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });

  it('skips markers inside node_modules', async () => {
    const root = makeWorkspace({ 'node_modules/x/.chezmoiversion': '1' });
    const results = await createNodesV2[1](
      ['node_modules/x/.chezmoiversion'],
      {},
      makeContext(root),
    );
    expect(results).toHaveLength(0);
  });

  it('produces deterministic output regardless of input order', async () => {
    const root = makeWorkspace({
      'a/.chezmoiversion': '1',
      'b/install.conf.yaml': '[]',
    });
    const fwd = await createNodesV2[1](
      ['a/.chezmoiversion', 'b/install.conf.yaml'],
      {},
      makeContext(root),
    );
    const rev = await createNodesV2[1](
      ['b/install.conf.yaml', 'a/.chezmoiversion'],
      {},
      makeContext(root),
    );
    expect(fwd).toEqual(rev);
  });

  it('picks one deterministic winner when a dir holds several markers', async () => {
    const root = makeWorkspace({
      'dot/.chezmoiversion': '1',
      'dot/install.conf.yaml': '[]',
    });
    const fwd = await createNodesV2[1](
      ['dot/.chezmoiversion', 'dot/install.conf.yaml'],
      {},
      makeContext(root),
    );
    const rev = await createNodesV2[1](
      ['dot/install.conf.yaml', 'dot/.chezmoiversion'],
      {},
      makeContext(root),
    );
    expect(fwd).toEqual(rev);
    expect(fwd).toHaveLength(1);
  });
});
