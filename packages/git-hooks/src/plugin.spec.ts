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
  const root = mkdtempSync(join(tmpdir(), 'nx-git-hooks-'));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const LEFTHOOK = `
pre-commit:
  commands:
    lint:
      run: npx eslint {staged_files}
pre-push:
  commands:
    test:
      run: npm test
`;

describe('@nx-devkit/git-hooks createNodesV2', () => {
  it('triggers on lefthook and pre-commit config files', () => {
    expect(createNodesV2[0]).toBe(
      '**/{lefthook.yml,lefthook.yaml,.lefthook.yml,.lefthook.yaml,.pre-commit-config.yaml}',
    );
  });

  it('infers one hooks:<name> target per lefthook section plus hooks:install', async () => {
    const root = makeWorkspace({ 'packages/app/lefthook.yml': LEFTHOOK });
    const results = await createNodesV2[1](['packages/app/lefthook.yml'], {}, makeContext(root));

    const project = results[0]![1].projects!['packages/app']!;
    const targets = project.targets!;
    expect(Object.keys(targets).sort()).toEqual([
      'hooks:install',
      'hooks:pre-commit',
      'hooks:pre-push',
    ]);
  });

  it('hooks:<name> runs `lefthook run <name>` and is cacheable with source inputs', async () => {
    const root = makeWorkspace({ 'packages/app/lefthook.yml': LEFTHOOK });
    const results = await createNodesV2[1](['packages/app/lefthook.yml'], {}, makeContext(root));

    const target = results[0]![1].projects!['packages/app']!.targets!['hooks:pre-commit']!;
    expect(target.executor).toBe('nx:run-commands');
    expect(target.options).toEqual({
      command: 'npx lefthook run pre-commit',
      cwd: '{projectRoot}',
    });
    expect(target.cache).toBe(true);
    expect(target.inputs).toEqual(
      expect.arrayContaining(['{projectRoot}/**/*', '{projectRoot}/lefthook.yml']),
    );
  });

  it('hooks:install runs `lefthook install` and is never cached', async () => {
    const root = makeWorkspace({ 'packages/app/lefthook.yml': LEFTHOOK });
    const results = await createNodesV2[1](['packages/app/lefthook.yml'], {}, makeContext(root));

    const install = results[0]![1].projects!['packages/app']!.targets!['hooks:install']!;
    expect(install.executor).toBe('nx:run-commands');
    expect(install.cache).toBe(false);
    expect(install.options).toEqual({ command: 'npx lefthook install', cwd: '{projectRoot}' });
  });

  it('.pre-commit-config.yaml infers hooks:run and hooks:install', async () => {
    const root = makeWorkspace({
      'packages/app/.pre-commit-config.yaml': 'repos: []\n',
    });
    const results = await createNodesV2[1](
      ['packages/app/.pre-commit-config.yaml'],
      {},
      makeContext(root),
    );

    const targets = results[0]![1].projects!['packages/app']!.targets!;
    expect(Object.keys(targets).sort()).toEqual(['hooks:install', 'hooks:run']);
    expect(targets['hooks:run']!.options).toEqual({
      command: 'pre-commit run --all-files',
      cwd: '{projectRoot}',
    });
    expect(targets['hooks:run']!.cache).toBe(true);
    expect(targets['hooks:install']!.options).toEqual({
      command: 'pre-commit install',
      cwd: '{projectRoot}',
    });
    expect(targets['hooks:install']!.cache).toBe(false);
  });

  it('a directory with both config kinds merges into one target set', async () => {
    const root = makeWorkspace({
      'packages/app/lefthook.yml': LEFTHOOK,
      'packages/app/.pre-commit-config.yaml': 'repos: []\n',
    });
    const results = await createNodesV2[1](
      ['packages/app/lefthook.yml', 'packages/app/.pre-commit-config.yaml'],
      {},
      makeContext(root),
    );

    expect(results).toHaveLength(1);
    const targets = results[0]![1].projects!['packages/app']!.targets!;
    expect(Object.keys(targets).sort()).toEqual([
      'hooks:install',
      'hooks:pre-commit',
      'hooks:pre-push',
      'hooks:run',
    ]);
    // hooks:install installs every configured hook manager, sequentially.
    expect(targets['hooks:install']!.options).toEqual({
      commands: ['npx lefthook install', 'pre-commit install'],
      parallel: false,
      cwd: '{projectRoot}',
    });
  });

  it('supports dotfile lefthook configs', async () => {
    const root = makeWorkspace({ 'packages/app/.lefthook.yaml': LEFTHOOK });
    const results = await createNodesV2[1](['packages/app/.lefthook.yaml'], {}, makeContext(root));

    const targets = results[0]![1].projects!['packages/app']!.targets!;
    expect(targets['hooks:pre-commit']).toBeDefined();
    expect(targets['hooks:install']).toBeDefined();
  });

  it('merges hook names from several lefthook configs in one directory', async () => {
    const root = makeWorkspace({
      'packages/app/lefthook.yml': 'pre-commit:\n  commands:\n    lint:\n      run: npx eslint .\n',
      'packages/app/.lefthook.yml':
        'commit-msg:\n  commands:\n    cl:\n      run: npx commitlint --edit\n',
    });
    const results = await createNodesV2[1](
      ['packages/app/lefthook.yml', 'packages/app/.lefthook.yml'],
      {},
      makeContext(root),
    );

    const targets = results[0]![1].projects!['packages/app']!.targets!;
    expect(Object.keys(targets).sort()).toEqual([
      'hooks:commit-msg',
      'hooks:install',
      'hooks:pre-commit',
    ]);
    expect(targets['hooks:pre-commit']!.inputs).toContain('{projectRoot}/.lefthook.yml');
  });

  it('maps a workspace-root config onto the root project', async () => {
    const root = makeWorkspace({ 'lefthook.yml': LEFTHOOK });
    const results = await createNodesV2[1](['lefthook.yml'], {}, makeContext(root));

    expect(results).toHaveLength(1);
    const targets = results[0]![1].projects!['']!.targets!;
    expect(targets['hooks:pre-commit']).toBeDefined();
    expect(targets['hooks:pre-commit']!.inputs).toContain('{workspaceRoot}/lefthook.yml');
    // At the workspace root there is no `**/*` — it would hash the whole monorepo.
    expect(targets['hooks:pre-commit']!.inputs).not.toContain('{workspaceRoot}/**/*');
  });

  it('does not treat lefthook setting keys as hook targets', async () => {
    const root = makeWorkspace({
      'lefthook.yml': `
min_version: 1.5.0
skip_output:
  - meta
remote:
  git_url: git@example.com:repo.git
pre-commit:
  commands:
    lint:
      run: npx eslint .
`,
    });
    const results = await createNodesV2[1](['lefthook.yml'], {}, makeContext(root));

    const targets = results[0]![1].projects!['']!.targets!;
    expect(Object.keys(targets).sort()).toEqual(['hooks:install', 'hooks:pre-commit']);
  });

  it('honors targetPrefix option', async () => {
    const root = makeWorkspace({
      'lefthook.yml': LEFTHOOK,
      '.pre-commit-config.yaml': 'repos: []\n',
    });
    const results = await createNodesV2[1](
      ['lefthook.yml', '.pre-commit-config.yaml'],
      { targetPrefix: 'githooks' },
      makeContext(root),
    );

    const targets = results[0]![1].projects!['']!.targets!;
    expect(Object.keys(targets).sort()).toEqual([
      'githooks:install',
      'githooks:pre-commit',
      'githooks:pre-push',
      'githooks:run',
    ]);
  });

  it('still emits hooks:install when the lefthook config cannot be parsed', async () => {
    const root = makeWorkspace({ 'lefthook.yml': 'pre-commit:\n  commands: [unclosed\n' });
    const results = await createNodesV2[1](['lefthook.yml'], {}, makeContext(root));

    // A broken config must not break the project graph — no hook targets,
    // but installing hooks is still inferable from the file's presence.
    const targets = results[0]![1].projects!['']!.targets!;
    expect(Object.keys(targets).sort()).toEqual(['hooks:install']);
  });

  it('a lefthook section named install loses to the fixed hooks:install target', async () => {
    const root = makeWorkspace({
      'lefthook.yml': 'install:\n  commands:\n    x:\n      run: y\n',
    });
    const results = await createNodesV2[1](['lefthook.yml'], {}, makeContext(root));

    const targets = results[0]![1].projects!['']!.targets!;
    expect(Object.keys(targets)).toEqual(['hooks:install']);
    expect(targets['hooks:install']!.options).toEqual({
      command: 'npx lefthook install',
      cwd: '{projectRoot}',
    });
  });

  it('skips configs outside the workspace', async () => {
    const root = makeWorkspace();
    const results = await createNodesV2[1](['../outside/lefthook.yml'], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });

  it('skips configs inside node_modules', async () => {
    const root = makeWorkspace({ 'node_modules/x/lefthook.yml': LEFTHOOK });
    const results = await createNodesV2[1](['node_modules/x/lefthook.yml'], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });

  it('produces deterministic output regardless of input order', async () => {
    const root = makeWorkspace({
      'a/lefthook.yml': LEFTHOOK,
      'b/.pre-commit-config.yaml': 'repos: []\n',
    });
    const fwd = await createNodesV2[1](
      ['a/lefthook.yml', 'b/.pre-commit-config.yaml'],
      {},
      makeContext(root),
    );
    const rev = await createNodesV2[1](
      ['b/.pre-commit-config.yaml', 'a/lefthook.yml'],
      {},
      makeContext(root),
    );
    expect(fwd).toEqual(rev);
  });

  it('returns no result for a directory whose configs produce nothing', async () => {
    // A pre-commit glob only fires on files the glob matched — but an empty
    // result set stays out of the graph entirely.
    const root = makeWorkspace();
    const results = await createNodesV2[1]([], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });
});
