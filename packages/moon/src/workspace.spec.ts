import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectMoonWorkspace } from './workspace.ts';

function makeWorkspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-moon-ws-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe('detectMoonWorkspace', () => {
  it('detects .moon/workspace.yml', () => {
    const root = makeWorkspace({ '.moon/workspace.yml': 'projects: []\n' });
    expect(detectMoonWorkspace(root)).toEqual({
      workspaceFile: '.moon/workspace.yml',
      toolchainFile: undefined,
      projectIdsByRoot: {},
    });
  });

  it('detects .moon/workspace.yaml', () => {
    const root = makeWorkspace({ '.moon/workspace.yaml': 'projects: []\n' });
    expect(detectMoonWorkspace(root)).toEqual({
      workspaceFile: '.moon/workspace.yaml',
      toolchainFile: undefined,
      projectIdsByRoot: {},
    });
  });

  it('detects .moon/toolchain.yml alongside the workspace file', () => {
    const root = makeWorkspace({
      '.moon/workspace.yml': 'projects: []\n',
      '.moon/toolchain.yml': 'node: {}\n',
    });
    expect(detectMoonWorkspace(root)).toEqual({
      workspaceFile: '.moon/workspace.yml',
      toolchainFile: '.moon/toolchain.yml',
      projectIdsByRoot: {},
    });
  });

  it('detects .moon/toolchain.yaml', () => {
    const root = makeWorkspace({
      '.moon/workspace.yml': 'projects: []\n',
      '.moon/toolchain.yaml': 'node: {}\n',
    });
    expect(detectMoonWorkspace(root).toolchainFile).toBe('.moon/toolchain.yaml');
  });

  it('returns nothing when no .moon directory exists', () => {
    const root = makeWorkspace({ 'packages/app/moon.yml': 'tasks: {}\n' });
    expect(detectMoonWorkspace(root)).toEqual({
      workspaceFile: undefined,
      toolchainFile: undefined,
      projectIdsByRoot: {},
    });
  });

  it('reads the projects map into projectIdsByRoot', () => {
    const root = makeWorkspace({
      '.moon/workspace.yml': [
        'projects:',
        '  app: apps/app',
        '  shared:',
        '    path: packages/lib-shared',
        '',
      ].join('\n'),
    });
    expect(detectMoonWorkspace(root).projectIdsByRoot).toEqual({
      'apps/app': 'app',
      'packages/lib-shared': 'shared',
    });
  });

  it('yields no ids for the glob list form or an unparseable file', () => {
    const globbed = makeWorkspace({ '.moon/workspace.yml': "projects: ['packages/*']\n" });
    expect(detectMoonWorkspace(globbed).projectIdsByRoot).toEqual({});

    const broken = makeWorkspace({ '.moon/workspace.yml': 'projects: [unclosed\n' });
    expect(detectMoonWorkspace(broken).projectIdsByRoot).toEqual({});
  });
});
