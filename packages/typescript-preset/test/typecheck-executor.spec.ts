import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectCompiler } from '../src/executors/typecheck/executor.js';

let workspaceRoot: string;
let projectRoot: string;

function installPkg(root: string, name: string): void {
  const dir = join(root, 'node_modules', name);
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{}');
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'nx-devkit-typecheck-ws-'));
  projectRoot = join(workspaceRoot, 'packages', 'lib');
  mkdirSync(projectRoot, { recursive: true });
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('detectCompiler', () => {
  it('resolves native tsc from @typescript/native (typescript@7 side-by-side)', () => {
    installPkg(workspaceRoot, '@typescript/native');
    installPkg(workspaceRoot, 'typescript');
    expect(detectCompiler(workspaceRoot, projectRoot, true)).toEqual({
      bin: 'tsc',
      packageName: '@typescript/native',
    });
  });

  it('falls back to legacy tsgo from @typescript/native-preview', () => {
    installPkg(workspaceRoot, '@typescript/native-preview');
    installPkg(workspaceRoot, 'typescript');
    expect(detectCompiler(workspaceRoot, projectRoot, true)).toEqual({
      bin: 'tsgo',
      packageName: '@typescript/native-preview',
    });
  });

  it('prefers @typescript/native over the legacy preview when both exist', () => {
    installPkg(workspaceRoot, '@typescript/native');
    installPkg(workspaceRoot, '@typescript/native-preview');
    installPkg(workspaceRoot, 'typescript');
    expect(detectCompiler(workspaceRoot, projectRoot, true)).toEqual({
      bin: 'tsc',
      packageName: '@typescript/native',
    });
  });

  it('falls back to plain tsc from the typescript package', () => {
    installPkg(workspaceRoot, 'typescript');
    expect(detectCompiler(workspaceRoot, projectRoot, true)).toEqual({
      bin: 'tsc',
      packageName: 'typescript',
    });
  });

  it('finds a project-local install of @typescript/native', () => {
    installPkg(workspaceRoot, 'typescript');
    installPkg(projectRoot, '@typescript/native');
    expect(detectCompiler(workspaceRoot, projectRoot, true)).toEqual({
      bin: 'tsc',
      packageName: '@typescript/native',
    });
  });

  it('ignores native packages when preferNative is false', () => {
    installPkg(workspaceRoot, '@typescript/native');
    installPkg(workspaceRoot, '@typescript/native-preview');
    installPkg(workspaceRoot, 'typescript');
    expect(detectCompiler(workspaceRoot, projectRoot, false)).toEqual({
      bin: 'tsc',
      packageName: 'typescript',
    });
  });
});
