import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CreateNodesContextV2, TargetConfiguration } from '@nx/devkit';
import { afterEach, describe, expect, it } from 'vitest';
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
  const root = mkdtempSync(join(tmpdir(), 'nx-just-'));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const SIMPLE = `build target="release":
    cargo build --{{target}}

test-unit: build
    ./run-tests

_private:
    echo secret
`;

async function createNodes(
  root: string,
  files: string[],
  options: Record<string, unknown> = {},
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

describe('@nx-devkit/just createNodesV2', () => {
  it('watches justfile names', () => {
    expect(createNodesV2[0]).toBe('**/{justfile,JUSTFILE,.justfile,just.just}');
  });

  it('infers just:<recipe> targets running just <recipe>', async () => {
    const root = makeWorkspace({ justfile: SIMPLE });
    const projects = await createNodes(root, ['justfile']);

    const build = projects['']?.targets?.['just:build'];
    expect(build?.executor).toBe('nx:run-commands');
    expect(build?.options).toMatchObject({ command: 'just build', cwd: '{projectRoot}' });
    expect(projects['']?.targets?.['just:test-unit']).toMatchObject({
      options: { command: 'just test-unit' },
    });
  });

  it('does not create targets for private recipes', async () => {
    const root = makeWorkspace({ justfile: SIMPLE });
    const projects = await createNodes(root, ['justfile']);

    expect(projects['']?.targets?.['just:_private']).toBeUndefined();
  });

  it('maps prior deps to dependsOn on the same project', async () => {
    const root = makeWorkspace({ justfile: SIMPLE });
    const projects = await createNodes(root, ['justfile']);

    expect(projects['']?.targets?.['just:test-unit']?.dependsOn).toEqual([
      { target: 'just:build' },
    ]);
  });

  it('excludes subsequent && deps from dependsOn', async () => {
    const root = makeWorkspace({
      justfile: `a: b && c
    echo a
b:
    echo b
c:
    echo c
`,
    });
    const projects = await createNodes(root, ['justfile']);
    expect(projects['']?.targets?.['just:a']?.dependsOn).toEqual([{ target: 'just:b' }]);
  });

  it('documents params on parameterized recipes', async () => {
    const root = makeWorkspace({ justfile: SIMPLE });
    const projects = await createNodes(root, ['justfile']);

    const build = projects['']?.targets?.['just:build'];
    expect(String(build?.metadata?.description)).toContain('target="release"');
  });

  it('places targets on the project owning a nested justfile', async () => {
    const root = makeWorkspace({ 'tools/scripts/justfile': SIMPLE });
    const projects = await createNodes(root, ['tools/scripts/justfile']);

    expect(projects['tools/scripts']?.targets?.['just:build']).toMatchObject({
      options: { command: 'just build', cwd: '{projectRoot}' },
    });
    expect(projects['tools/scripts']?.targets?.['just:build']?.inputs).toContain(
      '{projectRoot}/justfile',
    );
  });

  it('recurses into mod files', async () => {
    const root = makeWorkspace({
      justfile: `mod tools

a:
    echo a
`,
      'tools.just': `check:
    ./check
`,
    });
    const projects = await createNodes(root, ['justfile']);

    expect(projects['']?.targets?.['just:tools::check']).toMatchObject({
      options: { command: 'just tools::check' },
    });
  });

  it('resolves mod deps to mod targets', async () => {
    const root = makeWorkspace({
      justfile: `mod tools

a: tools::check
    echo a
`,
      'tools/check.just': '',
      'tools.just': `check:
    ./check
`,
    });
    const projects = await createNodes(root, ['justfile']);

    expect(projects['']?.targets?.['just:a']?.dependsOn).toEqual([{ target: 'just:tools::check' }]);
  });

  it('follows explicit mod paths', async () => {
    const root = makeWorkspace({
      justfile: `mod tools 'tools/custom.just'

a:
    echo a
`,
      'tools/custom.just': `verify:
    ./verify
`,
    });
    const projects = await createNodes(root, ['justfile']);

    expect(projects['']?.targets?.['just:tools::verify']).toBeDefined();
  });

  it('skips missing optional modules silently', async () => {
    const root = makeWorkspace({
      justfile: `mod? gone

a:
    echo a
`,
    });
    const projects = await createNodes(root, ['justfile']);
    expect(projects['']?.targets?.['just:a']).toBeDefined();
  });

  it('infers alias targets running just <alias>', async () => {
    const root = makeWorkspace({
      justfile: `alias b := build

build:
    echo build
`,
    });
    const projects = await createNodes(root, ['justfile']);
    expect(projects['']?.targets?.['just:b']).toMatchObject({
      options: { command: 'just b' },
    });
  });

  it('honours a custom targetPrefix', async () => {
    const root = makeWorkspace({ justfile: SIMPLE });
    const projects = await createNodes(root, ['justfile'], { targetPrefix: 'j:' });

    expect(projects['']?.targets?.['j:build']).toMatchObject({
      options: { command: 'just build' },
    });
    expect(projects['']?.targets?.['j:test-unit']?.dependsOn).toEqual([{ target: 'j:build' }]);
  });

  it('skips files outside the workspace and in node_modules', async () => {
    const root = makeWorkspace({
      'node_modules/x/justfile': SIMPLE,
    });
    const projects = await createNodes(root, ['../outside/justfile', 'node_modules/x/justfile']);
    expect(Object.keys(projects)).toHaveLength(0);
  });

  it('groups several justfiles in one directory into a single target set', async () => {
    const root = makeWorkspace({
      'a/justfile': SIMPLE,
      'a/JUSTFILE': `other:
    echo o
`,
    });
    const results = await createNodesV2[1](['a/justfile', 'a/JUSTFILE'], {}, makeContext(root));

    expect(results).toHaveLength(1);
    expect(Object.keys(results[0]![1].projects!.a!.targets!)).toContain('just:build');
  });

  it('produces deterministic output regardless of input order', async () => {
    const root = makeWorkspace({
      'a/justfile': SIMPLE,
      'b/justfile': SIMPLE,
    });
    const fwd = await createNodesV2[1](['a/justfile', 'b/justfile'], {}, makeContext(root));
    const rev = await createNodesV2[1](['b/justfile', 'a/justfile'], {}, makeContext(root));
    expect(fwd).toEqual(rev);
  });
});
