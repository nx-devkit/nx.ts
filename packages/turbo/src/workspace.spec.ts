import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverWorkspacePackages, readWorkspacePatterns, sortPathsByDepth } from './workspace.ts';

function makeWorkspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-turbo-ws-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const pkg = (name: string, scripts: Record<string, string> = {}) =>
  JSON.stringify({ name, scripts });

describe('readWorkspacePatterns', () => {
  it('reads the workspaces array form from package.json', () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({
        name: 'root',
        workspaces: ['packages/*', 'apps/*'],
      }),
    });
    expect(readWorkspacePatterns(root)).toEqual(['packages/*', 'apps/*']);
  });

  it('reads the workspaces.packages object form', () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({
        name: 'root',
        workspaces: { packages: ['libs/*'] },
      }),
    });
    expect(readWorkspacePatterns(root)).toEqual(['libs/*']);
  });

  it('reads packages from pnpm-workspace.yaml', () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({ name: 'root' }),
      'pnpm-workspace.yaml': [
        'packages:',
        "  - 'apps/*'",
        '  - "packages/**"',
        '  - "!packages/legacy"',
        '',
        'catalog:',
        '  react: ^19',
        '',
      ].join('\n'),
    });
    expect(readWorkspacePatterns(root)).toEqual(['apps/*', 'packages/**', '!packages/legacy']);
  });

  it('reads packages from lerna.json', () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({ name: 'root' }),
      'lerna.json': JSON.stringify({ packages: ['modules/*'] }),
    });
    expect(readWorkspacePatterns(root)).toEqual(['modules/*']);
  });

  it('falls back to packages/* and apps/* when nothing is declared', () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({ name: 'root' }),
    });
    expect(readWorkspacePatterns(root)).toEqual(['packages/*', 'apps/*']);
  });

  it('prefers package.json workspaces over pnpm-workspace.yaml', () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({
        name: 'root',
        workspaces: ['modules/*'],
      }),
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
    });
    expect(readWorkspacePatterns(root)).toEqual(['modules/*']);
  });
});

describe('discoverWorkspacePackages', () => {
  it('finds every package dir matching the workspace globs', () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({
        name: 'root',
        workspaces: ['packages/*'],
      }),
      'packages/app/package.json': pkg('app', { build: 'tsc' }),
      'packages/lib/package.json': pkg('lib', { build: 'tsc', test: 'vitest' }),
      'packages/empty/package.json': pkg('empty'),
      // not matched by the glob
      'tools/internal/package.json': pkg('internal', { build: 'tsc' }),
    });
    const pkgs = discoverWorkspacePackages(root);
    expect(pkgs.map((p) => p.name)).toEqual(['app', 'empty', 'lib']);
    expect(pkgs.map((p) => p.root)).toEqual(['packages/app', 'packages/empty', 'packages/lib']);
  });

  it('expands ** globs to nested packages', () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({
        name: 'root',
        workspaces: ['packages/**'],
      }),
      'packages/app/package.json': pkg('app'),
      'packages/group/nested/package.json': pkg('nested'),
    });
    const pkgs = discoverWorkspacePackages(root);
    expect(pkgs.map((p) => p.root).sort()).toEqual(['packages/app', 'packages/group/nested']);
  });

  it('honours ! negation patterns', () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({
        name: 'root',
        workspaces: ['packages/*', '!packages/legacy'],
      }),
      'packages/app/package.json': pkg('app'),
      'packages/legacy/package.json': pkg('legacy'),
    });
    expect(discoverWorkspacePackages(root).map((p) => p.name)).toEqual(['app']);
  });

  it('never descends into node_modules or hidden dirs', () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({
        name: 'root',
        workspaces: ['packages/**'],
      }),
      'packages/app/package.json': pkg('app'),
      'packages/app/node_modules/dep/package.json': pkg('dep'),
      'packages/.hidden/package.json': pkg('hidden'),
    });
    expect(discoverWorkspacePackages(root).map((p) => p.name)).toEqual(['app']);
  });

  it('exposes the package scripts', () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({
        name: 'root',
        workspaces: ['packages/*'],
      }),
      'packages/app/package.json': pkg('app', { build: 'tsc -b' }),
    });
    expect(discoverWorkspacePackages(root)[0]?.scripts).toEqual({
      build: 'tsc -b',
    });
  });

  it('returns an empty list for a workspace without packages', () => {
    const root = makeWorkspace({
      'package.json': JSON.stringify({ name: 'root', workspaces: [] }),
    });
    expect(discoverWorkspacePackages(root)).toEqual([]);
  });
});

describe('sortPathsByDepth', () => {
  it('sorts shallow paths first, then lexically', () => {
    expect(
      sortPathsByDepth(['packages/b/turbo.json', 'turbo.json', 'packages/a/turbo.json']),
    ).toEqual(['turbo.json', 'packages/a/turbo.json', 'packages/b/turbo.json']);
  });
});
