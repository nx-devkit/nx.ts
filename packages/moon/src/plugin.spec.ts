import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CreateNodesContextV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit';
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
  const root = mkdtempSync(join(tmpdir(), 'nx-moon-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const APP_MOON = [
  "id: 'app'",
  "language: 'typescript'",
  "type: 'application'",
  'tags:',
  "  - 'frontend'",
  'dependsOn:',
  "  - 'shared'",
  'tasks:',
  '  build:',
  "    command: 'vite build'",
  '    deps:',
  "      - '^:build'",
  '    inputs:',
  "      - 'src/**/*'",
  '    outputs:',
  "      - 'dist'",
  '  test:',
  "    command: 'vitest run'",
  '    deps:',
  "      - 'build'",
  '  dev:',
  "    command: 'vite'",
  '',
].join('\n');

async function createNodes(
  root: string,
  files: string[],
  options: Record<string, unknown> = {},
): Promise<Record<string, Partial<ProjectConfiguration>>> {
  const results = await createNodesV2[1](files, options, makeContext(root));
  const projects: Record<string, Partial<ProjectConfiguration>> = {};
  for (const [, result] of results) {
    for (const [root_, project] of Object.entries(result.projects ?? {})) {
      const prior = projects[root_];
      projects[root_] = {
        ...prior,
        ...project,
        targets: { ...prior?.targets, ...project.targets } as Record<string, TargetConfiguration>,
      };
    }
  }
  return projects;
}

describe('@nx-devkit/moon createNodesV2', () => {
  it('watches moon.yml and moon.yaml files', () => {
    expect(createNodesV2[0]).toBe('**/moon.{yml,yaml}');
  });

  it('infers a target per task on the project that owns the moon.yml', async () => {
    const root = makeWorkspace({
      '.moon/workspace.yml': "projects: ['packages/*']\n",
      'packages/app/moon.yml': APP_MOON,
    });
    const projects = await createNodes(root, ['packages/app/moon.yml']);

    const build = projects['packages/app']?.targets?.build;
    expect(build).toMatchObject({
      executor: 'nx:run-commands',
      options: { command: 'vite build', cwd: '{projectRoot}' },
      cache: true,
      dependsOn: [{ target: 'build', dependencies: true }],
    });
    expect(build?.inputs).toContain('{projectRoot}/src/**/*');
    expect(build?.outputs).toEqual(['{projectRoot}/dist']);
    expect(projects['packages/app']?.targets?.test?.dependsOn).toEqual([{ target: 'build' }]);
  });

  it('marks moon dev tasks continuous like the server preset', async () => {
    const root = makeWorkspace({ 'packages/app/moon.yml': APP_MOON });
    const projects = await createNodes(root, ['packages/app/moon.yml']);

    expect(projects['packages/app']?.targets?.dev?.continuous).toBe(true);
    expect(projects['packages/app']?.targets?.dev?.cache).toBe(false);
  });

  it('maps id, tags, type, dependsOn and project metadata onto the project', async () => {
    const root = makeWorkspace({ 'packages/app/moon.yml': APP_MOON });
    const projects = await createNodes(root, ['packages/app/moon.yml']);
    const project = projects['packages/app'];

    expect(project).toMatchObject({
      root: 'packages/app',
      name: 'app',
      tags: ['frontend'],
      projectType: 'application',
      implicitDependencies: ['shared'],
    });
  });

  it('accepts a string project field as the project name', async () => {
    const root = makeWorkspace({
      'packages/app/moon.yml': "project: 'renamed'\ntasks:\n  build:\n    command: 'tsc'\n",
    });
    const projects = await createNodes(root, ['packages/app/moon.yml']);
    expect(projects['packages/app']?.name).toBe('renamed');
  });

  it('still infers a stray moon.yml without .moon/workspace.*', async () => {
    const root = makeWorkspace({
      'tools/oneoff/moon.yml': "tasks:\n  gen:\n    command: 'echo hi'\n",
    });
    const projects = await createNodes(root, ['tools/oneoff/moon.yml']);

    expect(projects['tools/oneoff']?.targets?.gen).toMatchObject({
      executor: 'nx:run-commands',
      options: { command: 'echo hi' },
    });
  });

  it('supports a moon.yml at the workspace root', async () => {
    const root = makeWorkspace({
      'moon.yml': "tasks:\n  all:\n    command: 'echo root'\n",
    });
    const projects = await createNodes(root, ['moon.yml']);

    expect(projects['']?.targets?.all).toMatchObject({ executor: 'nx:run-commands' });
  });

  it('adds detected .moon workspace and toolchain files to inputs and metadata', async () => {
    const root = makeWorkspace({
      '.moon/workspace.yaml': 'projects: []\n',
      '.moon/toolchain.yml': 'node: {}\n',
      'packages/app/moon.yml': APP_MOON,
    });
    const projects = await createNodes(root, ['packages/app/moon.yml']);
    const project = projects['packages/app'];
    const build = project?.targets?.build;

    expect(build?.inputs).toContain('{workspaceRoot}/.moon/workspace.yaml');
    expect(build?.inputs).toContain('{workspaceRoot}/.moon/toolchain.yml');
    expect(build?.inputs).toContain('{workspaceRoot}/packages/app/moon.yml');
    expect(project?.metadata).toMatchObject({
      moon: {
        workspaceFile: '.moon/workspace.yaml',
        toolchainFile: '.moon/toolchain.yml',
        language: 'typescript',
      },
    });
  });

  it('folds project-level env into every task env', async () => {
    const root = makeWorkspace({
      'packages/app/moon.yml': [
        'env:',
        "  LOG_LEVEL: 'info'",
        'tasks:',
        '  build:',
        "    command: 'vite build'",
        '    env:',
        "      NODE_ENV: 'production'",
        '',
      ].join('\n'),
    });
    const projects = await createNodes(root, ['packages/app/moon.yml']);

    expect(projects['packages/app']?.targets?.build?.options).toMatchObject({
      env: { LOG_LEVEL: 'info', NODE_ENV: 'production' },
    });
  });

  it('applies the targetPrefix option to target names and deps', async () => {
    const root = makeWorkspace({ 'packages/app/moon.yml': APP_MOON });
    const projects = await createNodes(root, ['packages/app/moon.yml'], {
      targetPrefix: 'moon:',
    });
    const targets = projects['packages/app']?.targets ?? {};

    expect(targets['moon:build']).toBeDefined();
    expect(targets.build).toBeUndefined();
    expect(targets['moon:build']?.dependsOn).toEqual([
      { target: 'moon:build', dependencies: true },
    ]);
    expect(targets['moon:test']?.dependsOn).toEqual([{ target: 'moon:build' }]);
  });

  it('skips a moon.yml that cannot be parsed', async () => {
    const root = makeWorkspace({
      'packages/app/moon.yml': 'tasks:\n  build: [unclosed\n',
    });
    const projects = await createNodes(root, ['packages/app/moon.yml']);

    expect(projects['packages/app']).toBeUndefined();
  });

  it('skips a moon.yml whose tasks map has no valid tasks', async () => {
    const root = makeWorkspace({ 'packages/app/moon.yml': 'tasks:\n  broken: 42\n' });
    const projects = await createNodes(root, ['packages/app/moon.yml']);

    expect(projects['packages/app']).toBeUndefined();
  });

  it('ignores moon.yml files under node_modules', async () => {
    const root = makeWorkspace({
      'node_modules/dep/moon.yml': "tasks:\n  x:\n    command: 'x'\n",
    });
    const results = await createNodesV2[1](['node_modules/dep/moon.yml'], {}, makeContext(root));
    const projects = results.flatMap(([, r]) => Object.keys(r.projects ?? {}));

    expect(projects).not.toContain('node_modules/dep');
  });

  it('emits one project when moon.yml and moon.yaml share a directory', async () => {
    const root = makeWorkspace({
      'packages/app/moon.yml': "id: 'yml-app'\ntasks:\n  build:\n    command: 'a'\n",
      'packages/app/moon.yaml': "id: 'yaml-app'\ntasks:\n  test:\n    command: 'b'\n",
    });
    const projects = await createNodes(root, ['packages/app/moon.yml', 'packages/app/moon.yaml']);

    // .yml wins — the pair is one project, not two merged sources.
    expect(projects['packages/app']?.name).toBe('yml-app');
    expect(projects['packages/app']?.targets?.build).toBeDefined();
    expect(projects['packages/app']?.targets?.test).toBeUndefined();
  });

  it('maps dependsOn moon ids onto the resolved Nx project names', async () => {
    const root = makeWorkspace({
      'packages/app/moon.yml': "dependsOn: ['shared']\ntasks:\n  build:\n    command: 'a'\n",
      'packages/shared/moon.yml': "tasks:\n  build:\n    command: 'b'\n",
      // The dep project's Nx name comes from package.json, not its moon id.
      'packages/shared/package.json': '{"name": "@acme/shared"}',
    });
    const projects = await createNodes(root, ['packages/app/moon.yml', 'packages/shared/moon.yml']);

    expect(projects['packages/app']?.implicitDependencies).toEqual(['@acme/shared']);
  });

  it('maps dependsOn through .moon/workspace.* projects ids', async () => {
    const root = makeWorkspace({
      '.moon/workspace.yml': 'projects:\n  shared: packages/lib\n',
      'packages/app/moon.yml': "dependsOn: ['shared']\ntasks:\n  build:\n    command: 'a'\n",
      'packages/lib/moon.yml': "tasks:\n  build:\n    command: 'b'\n",
      'packages/lib/package.json': '{"name": "@acme/lib"}',
    });
    const projects = await createNodes(root, ['packages/app/moon.yml', 'packages/lib/moon.yml']);

    expect(projects['packages/app']?.implicitDependencies).toEqual(['@acme/lib']);
  });

  it('maps proj:task deps onto resolved Nx project names', async () => {
    const root = makeWorkspace({
      'packages/app/moon.yml': "tasks:\n  deploy:\n    command: 'a'\n    deps: ['shared:build']\n",
      'packages/shared/moon.yml': "tasks:\n  build:\n    command: 'b'\n",
      // The dep project's Nx name comes from package.json, not its moon id.
      'packages/shared/package.json': '{"name": "@acme/shared"}',
    });
    const projects = await createNodes(root, ['packages/app/moon.yml', 'packages/shared/moon.yml']);

    expect(projects['packages/app']?.targets?.deploy?.dependsOn).toEqual([
      { target: 'build', projects: ['@acme/shared'] },
    ]);
  });

  it('maps workspace projects ids for roots without a moon.yml', async () => {
    const root = makeWorkspace({
      '.moon/workspace.yml': 'projects:\n  shared: packages/lib\n',
      'packages/app/moon.yml': "dependsOn: ['shared']\ntasks:\n  build:\n    command: 'a'\n",
      // Packages/lib has no moon.yml — moon still owns its id via the
      // workspace projects map; the Nx name comes from package.json.
      'packages/lib/package.json': '{"name": "@acme/lib"}',
    });
    const projects = await createNodes(root, ['packages/app/moon.yml']);

    expect(projects['packages/app']?.implicitDependencies).toEqual(['@acme/lib']);
  });

  it('falls back to the dir name for unmapped projects with no name source', async () => {
    const root = makeWorkspace({
      '.moon/workspace.yml': 'projects:\n  shared: packages/lib\n',
      'packages/app/moon.yml': "dependsOn: ['shared']\ntasks:\n  build:\n    command: 'a'\n",
    });
    const projects = await createNodes(root, ['packages/app/moon.yml']);

    expect(projects['packages/app']?.implicitDependencies).toEqual(['lib']);
  });

  it('keeps dependsOn ids that resolve to named moon projects', async () => {
    const root = makeWorkspace({
      'packages/app/moon.yml': "dependsOn: ['shared']\ntasks:\n  build:\n    command: 'a'\n",
      'packages/shared/moon.yml': "id: 'shared'\ntasks:\n  build:\n    command: 'b'\n",
    });
    const projects = await createNodes(root, ['packages/app/moon.yml', 'packages/shared/moon.yml']);

    expect(projects['packages/app']?.implicitDependencies).toEqual(['shared']);
  });

  it('infers independent projects for nested moon.yml files', async () => {
    const root = makeWorkspace({
      'packages/app/moon.yml': "tasks:\n  build:\n    command: 'vite build'\n",
      'packages/lib/moon.yaml': "tasks:\n  build:\n    command: 'tsc -b'\n",
    });
    const projects = await createNodes(root, ['packages/app/moon.yml', 'packages/lib/moon.yaml']);

    expect(projects['packages/app']?.targets?.build?.options).toMatchObject({
      command: 'vite build',
    });
    expect(projects['packages/lib']?.targets?.build?.options).toMatchObject({
      command: 'tsc -b',
    });
  });
});
