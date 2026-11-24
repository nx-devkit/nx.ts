import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CreateNodesContextV2, TargetConfiguration } from '@nx/devkit';
import { describe, expect, it } from 'vitest';
import { createNodesV2 } from './plugin.ts';
import type { NxDevkitMakeOptions } from './types.ts';

function makeContext(workspaceRoot: string): CreateNodesContextV2 {
  return {
    workspaceRoot,
    nxJsonConfiguration: {},
    projectGraph: { nodes: {}, dependencies: {} },
  } as unknown as CreateNodesContextV2;
}

function makeWorkspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-make-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const MAKEFILE = `
.PHONY: all clean force
all: build test
build: $(CFLAGS) src/main.c
	cc -o app src/main.c
test: build
	./run-tests
clean:
	rm -rf dist
lint-fix:
	eslint --fix .
_hidden:
	echo nope
%.o: %.c
	cc -c $<
docs::
	echo doubled
`;

async function createNodes(
  root: string,
  files: string[],
  options: NxDevkitMakeOptions = {},
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

describe('@nx-devkit/make createNodesV2', () => {
  it('watches Makefile files', () => {
    expect(createNodesV2[0]).toBe('**/Makefile');
  });

  it('infers one make:<name> target per rule', async () => {
    const root = makeWorkspace({ Makefile: MAKEFILE });
    const projects = await createNodes(root, ['Makefile']);

    const targets = projects['']?.targets ?? {};
    expect(Object.keys(targets).sort()).toEqual([
      'make:all',
      'make:build',
      'make:clean',
      'make:force',
      'make:lint-fix',
      'make:test',
    ]);
    // `force` is a rule-less .PHONY goal — still a runnable target.
    expect(targets['make:force']?.options).toMatchObject({
      command: 'make -C . -- force',
    });
  });

  it('runs make via nx:run-commands with -C and the goal only', async () => {
    const root = makeWorkspace({ 'tools/app/Makefile': MAKEFILE });
    const projects = await createNodes(root, ['tools/app/Makefile']);

    const target = projects['tools/app']?.targets?.['make:build'];
    expect(target).toMatchObject({
      executor: 'nx:run-commands',
      options: { command: 'make -C tools/app -- build' },
    });
    // Recipe text never lands in the command.
    expect(JSON.stringify(target)).not.toContain('cc -o app');
  });

  it('uses `make -C .` for the workspace-root Makefile', async () => {
    const root = makeWorkspace({ Makefile: MAKEFILE });
    const projects = await createNodes(root, ['Makefile']);

    expect(projects['']?.targets?.['make:build']?.options).toMatchObject({
      command: 'make -C . -- build',
    });
  });

  it('passes the goal after -- so option-shaped names survive', async () => {
    const root = makeWorkspace({ Makefile: '-setup:\n\techo x\n' });
    const projects = await createNodes(root, ['Makefile']);

    expect(projects['']?.targets?.['make:-setup']?.options).toMatchObject({
      command: 'make -C . -- -setup',
    });
  });

  it('emits no dependsOn — make already runs its own prerequisite DAG', async () => {
    const root = makeWorkspace({ Makefile: MAKEFILE });
    const projects = await createNodes(root, ['Makefile']);

    // Nx-level edges would only re-run phony/side-effecting prereqs.
    for (const target of Object.values(projects['']?.targets ?? {})) {
      expect(target.dependsOn).toBeUndefined();
    }
  });

  it('is not cacheable by default and honours the cache option', async () => {
    const root = makeWorkspace({ Makefile: MAKEFILE });

    const off = await createNodes(root, ['Makefile']);
    expect(off['']?.targets?.['make:build']?.cache).toBe(false);

    const on = await createNodes(root, ['Makefile'], { cache: true });
    expect(on['']?.targets?.['make:build']?.cache).toBe(true);
  });

  it('honours targetPrefix', async () => {
    const root = makeWorkspace({ Makefile: MAKEFILE });
    const projects = await createNodes(root, ['Makefile'], { targetPrefix: 'mk' });

    expect(projects['']?.targets?.['mk:build']).toBeDefined();
    expect(projects['']?.targets?.['mk:all']?.options).toMatchObject({
      command: 'make -C . -- all',
    });
  });

  it('hashes the Makefile and the dir contents minus noise dirs', async () => {
    const root = makeWorkspace({ 'tools/app/Makefile': MAKEFILE });
    const projects = await createNodes(root, ['tools/app/Makefile']);
    const inputs = projects['tools/app']?.targets?.['make:build']?.inputs ?? [];

    expect(inputs).toContain('{projectRoot}/Makefile');
    expect(inputs).toContain('{projectRoot}/**/*');
    expect(inputs).toContain('!{projectRoot}/node_modules/**/*');
    expect(inputs).toContain('!{projectRoot}/.git/**/*');
    expect(inputs).toContain('!{projectRoot}/dist/**/*');
    expect(inputs).toContain('!{projectRoot}/coverage/**/*');
  });

  it('emits one project per directory owning a Makefile', async () => {
    const root = makeWorkspace({
      Makefile: 'root-goal:\n\techo r\n',
      'packages/a/Makefile': 'a-goal:\n\techo a\n',
      'packages/b/Makefile': 'b-goal:\n\techo b\n',
    });
    const projects = await createNodes(root, [
      'Makefile',
      'packages/a/Makefile',
      'packages/b/Makefile',
    ]);

    expect(projects['']?.targets?.['make:root-goal']).toBeDefined();
    expect(projects['packages/a']?.targets?.['make:a-goal']).toMatchObject({
      options: { command: 'make -C packages/a -- a-goal' },
    });
    expect(projects['packages/b']?.targets?.['make:b-goal']).toBeDefined();
  });

  it('skips a Makefile with no inferable targets', async () => {
    const root = makeWorkspace({ 'empty/Makefile': 'FOO := bar\n# only vars\n' });
    const projects = await createNodes(root, ['empty/Makefile']);

    expect(projects['empty']).toBeUndefined();
  });

  it('skips a Makefile that cannot be read', async () => {
    const root = makeWorkspace({});
    const projects = await createNodes(root, ['ghost/Makefile']);

    expect(projects['ghost']).toBeUndefined();
  });

  it('ignores Makefiles under node_modules and outside the workspace', async () => {
    const root = makeWorkspace({
      Makefile: 'build:\n\techo ok\n',
      'node_modules/dep/Makefile': 'build:\n\techo dep\n',
    });
    const results = await createNodesV2[1](
      ['Makefile', 'node_modules/dep/Makefile', '../outside/Makefile'],
      {},
      makeContext(root),
    );
    const projectRoots = results.flatMap(([, r]) => Object.keys(r.projects ?? {}));

    expect(projectRoots).toEqual(['']);
  });

  it('produces identical output regardless of config-file order', async () => {
    const root = makeWorkspace({
      Makefile: 'root-goal:\n\techo r\n',
      'a/Makefile': 'a-goal:\n\techo a\n',
      'b/Makefile': 'b-goal:\n\techo b\n',
    });
    const forward = await createNodesV2[1](
      ['Makefile', 'a/Makefile', 'b/Makefile'],
      {},
      makeContext(root),
    );
    const reverse = await createNodesV2[1](
      ['b/Makefile', 'a/Makefile', 'Makefile'],
      {},
      makeContext(root),
    );

    expect(reverse).toEqual(forward);
  });
});
