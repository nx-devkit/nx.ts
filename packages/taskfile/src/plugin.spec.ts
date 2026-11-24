import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CreateNodesContextV2, TargetConfiguration } from '@nx/devkit';
import { logger } from '@nx/devkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodesV2 } from './plugin.ts';

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
  const root = mkdtempSync(join(tmpdir(), 'nx-taskfile-'));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const BASIC_TASKFILE = `version: '3'
tasks:
  build:
    desc: Build the app
    deps: [lint]
    cmds:
      - go build ./...
  lint:
    cmds:
      - golangci-lint run
  test:
    cmds:
      - go test ./...
`;

type Projects = Record<string, { root?: string; targets?: Record<string, TargetConfiguration> }>;

async function collect(
  root: string,
  files: string[],
  options: Record<string, unknown> = {},
): Promise<Projects> {
  const results = await createNodesV2[1](files, options, makeContext(root));
  const projects: Projects = {};
  for (const [, result] of results) {
    for (const [root_, project] of Object.entries(result.projects ?? {})) {
      const prev = projects[root_];
      projects[root_] = {
        ...prev,
        ...project,
        targets: { ...prev?.targets, ...project.targets },
      };
    }
  }
  return projects;
}

describe('@nx-devkit/taskfile createNodesV2', () => {
  it('watches every Taskfile spelling, *.dist.* included', () => {
    expect(createNodesV2[0]).toBe(
      '**/{Taskfile.yml,Taskfile.yaml,Taskfile.dist.yml,Taskfile.dist.yaml,taskfile.yml,taskfile.yaml,taskfile.dist.yml,taskfile.dist.yaml}',
    );
  });

  it('infers a task:<name> target per task on the owning project', async () => {
    const root = makeWorkspace({
      'packages/app/package.json': JSON.stringify({ name: 'app' }),
      'packages/app/Taskfile.yml': BASIC_TASKFILE,
    });
    const projects = await collect(root, ['packages/app/Taskfile.yml']);

    const targets = projects['packages/app']?.targets ?? {};
    expect(Object.keys(targets).sort()).toEqual(['task:build', 'task:lint', 'task:test']);
    expect(targets['task:build']).toMatchObject({
      executor: 'nx:run-commands',
      cache: false,
      options: { command: 'task build', cwd: '{projectRoot}' },
    });
  });

  it('infers targets on the root project for a workspace-root Taskfile', async () => {
    const root = makeWorkspace({ 'Taskfile.yml': BASIC_TASKFILE });
    const projects = await collect(root, ['Taskfile.yml']);

    expect(projects['']?.targets?.['task:build']).toBeDefined();
  });

  it('maps desc to metadata.description', async () => {
    const root = makeWorkspace({ 'Taskfile.yml': BASIC_TASKFILE });
    const projects = await collect(root, ['Taskfile.yml']);

    expect(projects['']?.targets?.['task:build']?.metadata?.description).toBe('Build the app');
  });

  it('emits no dependsOn — the task CLI runs deps itself', async () => {
    // `task build` already executes `deps: [lint]`; an Nx edge would
    // run `task lint` a second time.
    const root = makeWorkspace({ 'Taskfile.yml': BASIC_TASKFILE });
    const projects = await collect(root, ['Taskfile.yml']);

    expect(projects['']?.targets?.['task:build']?.dependsOn).toBeUndefined();
  });

  it('skips internal tasks', async () => {
    const root = makeWorkspace({
      'Taskfile.yml': `version: '3'
tasks:
  visible:
    cmds: [echo hi]
  helper:
    internal: true
    cmds: [echo never]
`,
    });
    const projects = await collect(root, ['Taskfile.yml']);

    const targets = projects['']?.targets ?? {};
    expect(targets['task:visible']).toBeDefined();
    expect(targets['task:helper']).toBeUndefined();
  });

  it('emits no target for an internal task even when another task deps on it', async () => {
    const root = makeWorkspace({
      'Taskfile.yml': `version: '3'
tasks:
  build:
    deps: [helper, lint]
  helper:
    internal: true
  lint: {}
`,
    });
    const projects = await collect(root, ['Taskfile.yml']);

    const targets = projects['']?.targets ?? {};
    expect(targets['task:build']).toBeDefined();
    expect(targets['task:lint']).toBeDefined();
    expect(targets['task:helper']).toBeUndefined();
  });

  it('emits namespaced targets for included taskfiles', async () => {
    const root = makeWorkspace({
      'Taskfile.yml': `version: '3'
includes:
  lib: ./lib
tasks:
  build:
    cmds: [go build ./...]
`,
      'lib/Taskfile.yml': `version: '3'
tasks:
  gen:
    desc: Generate code
    cmds: [./gen.sh]
`,
    });
    const projects = await collect(root, ['Taskfile.yml', 'lib/Taskfile.yml']);

    // The including file exposes the namespaced task…
    expect(projects['']?.targets?.['task:lib:gen']).toMatchObject({
      options: { command: 'task lib:gen', cwd: '{projectRoot}' },
    });
    // …and the included file still infers its own project targets.
    expect(projects.lib?.targets?.['task:gen']).toMatchObject({
      options: { command: 'task gen', cwd: '{projectRoot}' },
    });
  });

  it('supports the map include form and recurses nested includes', async () => {
    const root = makeWorkspace({
      'Taskfile.yml': `version: '3'
includes:
  lib:
    taskfile: ./lib/Taskfile.yml
tasks:
  all: {}
`,
      'lib/Taskfile.yml': `version: '3'
includes:
  proto: ./proto/Taskfile.yml
tasks:
  build: {}
`,
      'lib/proto/Taskfile.yml': `version: '3'
tasks:
  gen: {}
`,
    });
    const projects = await collect(root, ['Taskfile.yml']);

    const targets = projects['']?.targets ?? {};
    expect(targets['task:lib:build']).toBeDefined();
    expect(targets['task:lib:proto:gen']).toMatchObject({
      options: { command: 'task lib:proto:gen' },
    });
  });

  it('skips internal includes', async () => {
    const root = makeWorkspace({
      'Taskfile.yml': `version: '3'
includes:
  lib:
    taskfile: ./lib/Taskfile.yml
    internal: true
tasks:
  build: {}
`,
      'lib/Taskfile.yml': `version: '3'
tasks:
  gen: {}
`,
    });
    const projects = await collect(root, ['Taskfile.yml']);

    expect(projects['']?.targets?.['task:lib:gen']).toBeUndefined();
  });

  it('merges flatten includes into the parent namespace', async () => {
    const root = makeWorkspace({
      'Taskfile.yml': `version: '3'
includes:
  lib:
    taskfile: ./lib/Taskfile.yml
    flatten: true
tasks:
  build: {}
`,
      'lib/Taskfile.yml': `version: '3'
tasks:
  gen: {}
`,
    });
    const projects = await collect(root, ['Taskfile.yml']);

    const targets = projects['']?.targets ?? {};
    expect(targets['task:gen']).toMatchObject({ options: { command: 'task gen' } });
    expect(targets['task:lib:gen']).toBeUndefined();
  });

  it('skips a missing include, warning unless optional', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const root = makeWorkspace({
      'Taskfile.yml': `version: '3'
includes:
  gone: ./no-such-dir
  maybe:
    taskfile: ./also-missing
    optional: true
tasks:
  build: {}
`,
    });
    const projects = await collect(root, ['Taskfile.yml']);

    expect(Object.keys(projects['']?.targets ?? {})).toEqual(['task:build']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'gone'"));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("'maybe'"));
    warn.mockRestore();
  });

  it('breaks include cycles', async () => {
    const root = makeWorkspace({
      'Taskfile.yml': `version: '3'
includes:
  b: ./b
tasks:
  a-task: {}
`,
      'b/Taskfile.yml': `version: '3'
includes:
  a: ../Taskfile.yml
tasks:
  b-task: {}
`,
    });
    const projects = await collect(root, ['Taskfile.yml', 'b/Taskfile.yml']);

    const rootTargets = projects['']?.targets ?? {};
    expect(rootTargets['task:a-task']).toBeDefined();
    expect(rootTargets['task:b:b-task']).toBeDefined();
    // The cycle back into the root file stops after the first level.
    expect(rootTargets['task:b:a:a-task']).toBeUndefined();

    // The nested file is a matched config too: it sees the root once.
    const bTargets = projects.b?.targets ?? {};
    expect(bTargets['task:b-task']).toBeDefined();
    expect(bTargets['task:a:a-task']).toBeDefined();
  });

  it('adds every contributing taskfile to the inputs', async () => {
    const root = makeWorkspace({
      'Taskfile.yml': `version: '3'
includes:
  lib: ./lib
tasks:
  build: {}
`,
      'lib/Taskfile.yml': `version: '3'
tasks:
  gen: {}
`,
    });
    const projects = await collect(root, ['Taskfile.yml']);

    const inputs = projects['']?.targets?.['task:lib:gen']?.inputs ?? [];
    expect(inputs).toContain('default');
    expect(inputs).toContain('{workspaceRoot}/Taskfile.yml');
    expect(inputs).toContain('{workspaceRoot}/lib/Taskfile.yml');
  });

  it('infers targets from a *.dist.* Taskfile spelling', async () => {
    const root = makeWorkspace({
      'a/Taskfile.dist.yml': `version: '3'\ntasks:\n  gen: {}\n`,
    });
    const projects = await collect(root, ['a/Taskfile.dist.yml']);

    expect(projects.a?.targets?.['task:gen']).toBeDefined();
  });

  it('prefers Taskfile.yml over Taskfile.dist.yml in the same directory', async () => {
    const root = makeWorkspace({
      'a/Taskfile.yml': `version: '3'\ntasks:\n  from-yml: {}\n`,
      'a/Taskfile.dist.yml': `version: '3'\ntasks:\n  from-dist: {}\n`,
    });
    const projects = await collect(root, ['a/Taskfile.dist.yml', 'a/Taskfile.yml']);

    const targets = projects.a?.targets ?? {};
    expect(targets['task:from-yml']).toBeDefined();
    expect(targets['task:from-dist']).toBeUndefined();
  });

  it('picks the highest-priority Taskfile when a dir has several', async () => {
    const root = makeWorkspace({
      'a/Taskfile.yml': `version: '3'\ntasks:\n  from-yml: {}\n`,
      'a/Taskfile.yaml': `version: '3'\ntasks:\n  from-yaml: {}\n`,
    });
    const projects = await collect(root, ['a/Taskfile.yaml', 'a/Taskfile.yml']);

    const targets = projects.a?.targets ?? {};
    expect(targets['task:from-yml']).toBeDefined();
    expect(targets['task:from-yaml']).toBeUndefined();
  });

  it('skips taskfiles that cannot be parsed', async () => {
    const root = makeWorkspace({ 'Taskfile.yml': 'tasks: [unclosed' });
    const projects = await collect(root, ['Taskfile.yml']);

    expect(projects['']).toBeUndefined();
  });

  it('skips taskfiles under node_modules and outside the workspace', async () => {
    const root = makeWorkspace({
      'node_modules/dep/Taskfile.yml': `version: '3'\ntasks:\n  x: {}\n`,
    });
    const projects = await collect(root, ['node_modules/dep/Taskfile.yml', '../Taskfile.yml']);

    expect(Object.keys(projects)).toHaveLength(0);
  });

  it('skips tasks whose name would break the shell command', async () => {
    const root = makeWorkspace({
      'Taskfile.yml': `version: '3'
tasks:
  good: {}
  "evil;rm -rf /": {}
`,
    });
    const projects = await collect(root, ['Taskfile.yml']);

    const targets = projects['']?.targets ?? {};
    expect(targets['task:good']).toBeDefined();
    expect(Object.keys(targets)).toHaveLength(1);
  });

  it('honours the targetPrefix option', async () => {
    const root = makeWorkspace({ 'Taskfile.yml': BASIC_TASKFILE });
    const projects = await collect(root, ['Taskfile.yml'], { targetPrefix: 'tf' });

    const targets = projects['']?.targets ?? {};
    expect(targets['tf:build']).toBeDefined();
    expect(targets['task:build']).toBeUndefined();
  });

  it('honours the cache option', async () => {
    const root = makeWorkspace({ 'Taskfile.yml': BASIC_TASKFILE });
    const projects = await collect(root, ['Taskfile.yml'], { cache: true });

    expect(projects['']?.targets?.['task:build']?.cache).toBe(true);
  });

  it('produces deterministic output regardless of input order', async () => {
    const root = makeWorkspace({
      'a/Taskfile.yml': BASIC_TASKFILE,
      'b/Taskfile.yml': BASIC_TASKFILE,
    });
    const fwd = await createNodesV2[1](['a/Taskfile.yml', 'b/Taskfile.yml'], {}, makeContext(root));
    const rev = await createNodesV2[1](['b/Taskfile.yml', 'a/Taskfile.yml'], {}, makeContext(root));

    expect(fwd).toEqual(rev);
  });
});
