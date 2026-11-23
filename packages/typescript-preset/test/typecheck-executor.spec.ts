import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectCompiler, typecheckExecutor } from '../src/executors/typecheck/executor.js';
import { detectNativeTypescript } from '../src/config.js';

const createdDirs: string[] = [];

// The workspace sits one level below the tmp root so tests can stage a
// hoisted node_modules above the workspace root without touching /tmp.
function makeWorkspace(): { workspaceRoot: string; projectRoot: string } {
  const parent = mkdtempSync(join(tmpdir(), 'nx-devkit-typecheck-ws-'));
  const workspaceRoot = join(parent, 'workspace');
  const projectRoot = join(workspaceRoot, 'packages', 'lib');
  mkdirSync(projectRoot, { recursive: true });
  createdDirs.push(parent);
  return { workspaceRoot, projectRoot };
}

function installPkg(root: string, name: string): void {
  const dir = join(root, 'node_modules', name);
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{}');
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('detectCompiler', () => {
  it('resolves native tsc from @typescript/native (typescript@7 side-by-side)', () => {
    const { workspaceRoot, projectRoot } = makeWorkspace();
    installPkg(workspaceRoot, '@typescript/native');
    installPkg(workspaceRoot, 'typescript');
    expect(detectCompiler(workspaceRoot, projectRoot, true)).toEqual({
      bin: 'tsc',
      packageName: '@typescript/native',
    });
  });

  it('falls back to legacy tsgo from @typescript/native-preview', () => {
    const { workspaceRoot, projectRoot } = makeWorkspace();
    installPkg(workspaceRoot, '@typescript/native-preview');
    installPkg(workspaceRoot, 'typescript');
    expect(detectCompiler(workspaceRoot, projectRoot, true)).toEqual({
      bin: 'tsgo',
      packageName: '@typescript/native-preview',
    });
  });

  it('prefers @typescript/native over the legacy preview when both exist', () => {
    const { workspaceRoot, projectRoot } = makeWorkspace();
    installPkg(workspaceRoot, '@typescript/native');
    installPkg(workspaceRoot, '@typescript/native-preview');
    installPkg(workspaceRoot, 'typescript');
    expect(detectCompiler(workspaceRoot, projectRoot, true)).toEqual({
      bin: 'tsc',
      packageName: '@typescript/native',
    });
  });

  it('falls back to plain tsc from the typescript package', () => {
    const { workspaceRoot, projectRoot } = makeWorkspace();
    installPkg(workspaceRoot, 'typescript');
    expect(detectCompiler(workspaceRoot, projectRoot, true)).toEqual({
      bin: 'tsc',
      packageName: 'typescript',
    });
  });

  it('finds a project-local install of @typescript/native', () => {
    const { workspaceRoot, projectRoot } = makeWorkspace();
    installPkg(workspaceRoot, 'typescript');
    installPkg(projectRoot, '@typescript/native');
    expect(detectCompiler(workspaceRoot, projectRoot, true)).toEqual({
      bin: 'tsc',
      packageName: '@typescript/native',
    });
  });

  it('finds @typescript/native hoisted between the project and workspace roots', () => {
    const { workspaceRoot, projectRoot } = makeWorkspace();
    installPkg(workspaceRoot, 'typescript');
    // packages/ sits between packages/lib and the workspace root
    installPkg(join(workspaceRoot, 'packages'), '@typescript/native');
    expect(detectCompiler(workspaceRoot, projectRoot, true)).toEqual({
      bin: 'tsc',
      packageName: '@typescript/native',
    });
  });

  it('finds @typescript/native hoisted above the workspace root', () => {
    const { workspaceRoot, projectRoot } = makeWorkspace();
    installPkg(workspaceRoot, 'typescript');
    installPkg(join(workspaceRoot, '..'), '@typescript/native');
    expect(detectCompiler(workspaceRoot, projectRoot, true)).toEqual({
      bin: 'tsc',
      packageName: '@typescript/native',
    });
  });

  it('ignores native packages when preferNative is false', () => {
    const { workspaceRoot, projectRoot } = makeWorkspace();
    installPkg(workspaceRoot, '@typescript/native');
    installPkg(workspaceRoot, '@typescript/native-preview');
    installPkg(workspaceRoot, 'typescript');
    expect(detectCompiler(workspaceRoot, projectRoot, false)).toEqual({
      bin: 'tsc',
      packageName: 'typescript',
    });
  });
});

describe('typecheckExecutor', () => {
  it('fails when the project is missing from projectsConfigurations', async () => {
    const { workspaceRoot } = makeWorkspace();
    const result = await typecheckExecutor(
      {},
      { root: workspaceRoot, projectName: 'ghost', projectsConfigurations: { projects: {} } },
    );
    expect(result.success).toBe(false);
  });
});

describe('detectNativeTypescript', () => {
  it('reads the native dep declared in the project package.json', async () => {
    const { workspaceRoot, projectRoot } = makeWorkspace();
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ devDependencies: { '@typescript/native': 'npm:typescript@^7.0.2' } }),
    );
    await expect(detectNativeTypescript('packages/lib', workspaceRoot)).resolves.toBe(
      '@typescript/native',
    );
  });

  it('falls back to the workspace root package.json', async () => {
    const { workspaceRoot, projectRoot } = makeWorkspace();
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'lib' }));
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({ devDependencies: { '@typescript/native': 'npm:typescript@^7.0.2' } }),
    );
    await expect(detectNativeTypescript('packages/lib', workspaceRoot)).resolves.toBe(
      '@typescript/native',
    );
  });

  it('project declaration wins over the workspace root', async () => {
    const { workspaceRoot, projectRoot } = makeWorkspace();
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ devDependencies: { '@typescript/native-preview': '^7.0.0-dev.0' } }),
    );
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({ devDependencies: { '@typescript/native': 'npm:typescript@^7.0.2' } }),
    );
    await expect(detectNativeTypescript('packages/lib', workspaceRoot)).resolves.toBe(
      '@typescript/native-preview',
    );
  });

  it('returns false when neither manifest declares a native compiler', async () => {
    const { workspaceRoot, projectRoot } = makeWorkspace();
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'lib' }));
    writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({ name: 'ws' }));
    await expect(detectNativeTypescript('packages/lib', workspaceRoot)).resolves.toBe(false);
  });
});
