import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CreateNodesContextV2, TargetConfiguration } from '@nx/devkit';
import { afterAll, describe, expect, it } from 'vitest';
import { createNodesV2 } from './plugin.ts';

function makeContext(workspaceRoot: string): CreateNodesContextV2 {
  return {
    workspaceRoot,
    nxJsonConfiguration: {},
    projectGraph: { nodes: {}, dependencies: {} },
  } as unknown as CreateNodesContextV2;
}

const tempRoots: string[] = [];

function makeWorkspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-cargo-'));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

const CRATE = (name: string, deps = '') => `[package]
name = "${name}"
version = "0.1.0"
edition = "2021"
${deps}`;

const VIRTUAL_WS = (members: string) => `[workspace]
members = [${members}]
resolver = "2"
`;

interface ProjectShape {
  name?: string;
  root?: string;
  targets?: Record<string, TargetConfiguration>;
  implicitDependencies?: string[];
}

async function createNodes(
  root: string,
  files: string[],
  options: { clippy?: boolean; fmt?: boolean } = {},
): Promise<Record<string, ProjectShape>> {
  const results = await createNodesV2[1](files, options, makeContext(root));
  const projects: Record<string, ProjectShape> = {};
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

function workspaceFixture(): string {
  return makeWorkspace({
    'Cargo.toml': VIRTUAL_WS('"crates/*"'),
    'Cargo.lock': '# lock\n',
    'crates/app/Cargo.toml': CRATE(
      'app',
      `
[dependencies]
lib = { path = "../lib" }
`,
    ),
    'crates/app/src/main.rs': 'fn main() {}\n',
    'crates/lib/Cargo.toml': CRATE('lib'),
    'crates/lib/src/lib.rs': 'pub fn f() {}\n',
  });
}

const WS_FILES = ['Cargo.toml', 'crates/app/Cargo.toml', 'crates/lib/Cargo.toml'];

describe('@nx-devkit/cargo createNodesV2', () => {
  it('watches Cargo.toml files', () => {
    expect(createNodesV2[0]).toBe('**/Cargo.toml');
  });

  it('infers crate targets from a package manifest', async () => {
    const root = workspaceFixture();
    const projects = await createNodes(root, WS_FILES);

    const app = projects['crates/app'];
    expect(app?.name).toBe('app');
    expect(app?.targets?.build).toMatchObject({
      executor: 'nx:run-commands',
      cache: false,
      options: { command: 'cargo build -p app', cwd: '{projectRoot}' },
    });
    expect(app?.targets?.test).toMatchObject({
      cache: true,
      options: { command: 'cargo test -p app' },
    });
    expect(app?.targets?.clippy?.options).toMatchObject({
      command: 'cargo clippy -p app -- -D warnings',
    });
    expect(app?.targets?.fmt?.options).toMatchObject({
      command: 'cargo fmt -p app -- --check',
    });
  });

  it('hashes Cargo.toml, src, build.rs and the workspace manifest + Cargo.lock', async () => {
    const root = workspaceFixture();
    const projects = await createNodes(root, WS_FILES);
    const inputs = projects['crates/app']?.targets?.build?.inputs ?? [];

    expect(inputs).toContain('{projectRoot}/Cargo.toml');
    expect(inputs).toContain('{projectRoot}/src/**/*');
    expect(inputs).toContain('{projectRoot}/tests/**/*');
    expect(inputs).toContain('{projectRoot}/examples/**/*');
    expect(inputs).toContain('{projectRoot}/build.rs');
    expect(inputs).toContain('{workspaceRoot}/Cargo.toml');
    expect(inputs).toContain('{workspaceRoot}/Cargo.lock');
  });

  it('hashes the manifests and sources of path dependencies', async () => {
    const root = workspaceFixture();
    const projects = await createNodes(root, WS_FILES);
    const inputs = projects['crates/app']?.targets?.build?.inputs ?? [];

    expect(inputs).toContain('{workspaceRoot}/crates/lib/Cargo.toml');
    expect(inputs).toContain('{workspaceRoot}/crates/lib/src/**/*');
    expect(inputs).toContain('{workspaceRoot}/crates/lib/build.rs');
  });

  it('turns path dependencies into implicitDependencies edges', async () => {
    const root = workspaceFixture();
    const projects = await createNodes(root, WS_FILES);

    expect(projects['crates/app']?.implicitDependencies).toEqual(['lib']);
    expect(projects['crates/lib']?.implicitDependencies).toBeUndefined();
  });

  it('infers workspace-level build/test on a virtual root manifest', async () => {
    const root = workspaceFixture();
    const projects = await createNodes(root, WS_FILES);

    const ws = projects[''];
    expect(ws?.targets?.build).toMatchObject({
      executor: 'nx:run-commands',
      cache: false,
      options: { command: 'cargo build', cwd: '{projectRoot}' },
    });
    expect(ws?.targets?.test?.options).toMatchObject({ command: 'cargo test' });
    // no -p targets and no clippy/fmt on the virtual root
    expect(ws?.targets?.clippy).toBeUndefined();
    expect(ws?.targets?.fmt).toBeUndefined();
  });

  it('covers member sources in the virtual root inputs', async () => {
    const root = workspaceFixture();
    const projects = await createNodes(root, WS_FILES);
    const inputs = projects['']?.targets?.build?.inputs ?? [];

    expect(inputs).toContain('{projectRoot}/Cargo.toml');
    expect(inputs).toContain('{projectRoot}/Cargo.lock');
    expect(inputs).toContain('{projectRoot}/crates/app/src/**/*');
    expect(inputs).toContain('{projectRoot}/crates/lib/Cargo.toml');
  });

  it('gives a root package workspace member crate targets, not workspace targets', async () => {
    const root = makeWorkspace({
      'Cargo.toml': `[workspace]
members = ["crates/*"]

[package]
name = "root-crate"
version = "0.1.0"
`,
      'crates/app/Cargo.toml': CRATE('app'),
    });
    const projects = await createNodes(root, ['Cargo.toml', 'crates/app/Cargo.toml']);

    expect(projects['']?.targets?.build?.options).toMatchObject({
      command: 'cargo build -p root-crate',
    });
  });

  it('supports a standalone crate with no workspace', async () => {
    const root = makeWorkspace({
      'crates/solo/Cargo.toml': CRATE('solo'),
      'crates/solo/Cargo.lock': '# lock\n',
    });
    const projects = await createNodes(root, ['crates/solo/Cargo.toml']);

    const solo = projects['crates/solo'];
    expect(solo?.targets?.build?.options).toMatchObject({
      command: 'cargo build -p solo',
    });
    // its own dir holds the lockfile
    expect(solo?.targets?.build?.inputs).toContain('{projectRoot}/Cargo.lock');
  });

  it('supports a workspace root in a subdirectory', async () => {
    const root = makeWorkspace({
      'rust/Cargo.toml': VIRTUAL_WS('"crates/*"'),
      'rust/crates/app/Cargo.toml': CRATE('app'),
    });
    const projects = await createNodes(root, ['rust/Cargo.toml', 'rust/crates/app/Cargo.toml']);

    expect(projects.rust?.targets?.build?.options).toMatchObject({
      command: 'cargo build',
    });
    const app = projects['rust/crates/app'];
    expect(app?.targets?.build?.options).toMatchObject({
      command: 'cargo build -p app',
    });
    expect(app?.targets?.build?.inputs).toContain('{workspaceRoot}/rust/Cargo.lock');
  });

  it('resolves workspace = true deps through [workspace.dependencies]', async () => {
    const root = makeWorkspace({
      'Cargo.toml': `[workspace]
members = ["crates/*"]

[workspace.dependencies]
lib = { path = "crates/lib" }
`,
      'crates/app/Cargo.toml': CRATE(
        'app',
        `
[dependencies]
lib = { workspace = true }
`,
      ),
      'crates/lib/Cargo.toml': CRATE('lib'),
    });
    const projects = await createNodes(root, WS_FILES);

    expect(projects['crates/app']?.implicitDependencies).toEqual(['lib']);
  });

  it('lets an excluded crate lock in its own dir', async () => {
    const root = makeWorkspace({
      'Cargo.toml': `[workspace]
members = ["crates/*"]
exclude = ["crates/out"]
`,
      'crates/in/Cargo.toml': CRATE('inside'),
      'crates/out/Cargo.toml': CRATE('outside'),
    });
    const projects = await createNodes(root, [
      'Cargo.toml',
      'crates/in/Cargo.toml',
      'crates/out/Cargo.toml',
    ]);

    expect(projects['crates/in']?.targets?.build?.inputs).toContain('{workspaceRoot}/Cargo.lock');
    expect(projects['crates/out']?.targets?.build?.inputs).toContain('{projectRoot}/Cargo.lock');
  });

  it('honours clippy: false and fmt: false', async () => {
    const root = workspaceFixture();
    const projects = await createNodes(root, WS_FILES, { clippy: false, fmt: false });
    const targets = projects['crates/app']?.targets ?? {};

    expect(targets.build).toBeDefined();
    expect(targets.test).toBeDefined();
    expect(targets.clippy).toBeUndefined();
    expect(targets.fmt).toBeUndefined();
  });

  it('skips a Cargo.toml that cannot be parsed', async () => {
    const root = makeWorkspace({
      'Cargo.toml': 'this is [not toml =',
      'crates/app/Cargo.toml': CRATE('app'),
    });
    const projects = await createNodes(root, ['Cargo.toml', 'crates/app/Cargo.toml']);

    expect(projects['']).toBeUndefined();
    expect(projects['crates/app']?.name).toBe('app');
  });

  it('emits nothing for a manifest with neither [package] nor [workspace]', async () => {
    const root = makeWorkspace({
      'deps/Cargo.toml': '[dependencies]\nserde = "1"\n',
    });
    const results = await createNodesV2[1](['deps/Cargo.toml'], {}, makeContext(root));

    expect(results).toHaveLength(0);
  });

  it('ignores Cargo.toml under node_modules', async () => {
    const root = makeWorkspace({
      'node_modules/dep/Cargo.toml': CRATE('dep'),
    });
    const results = await createNodesV2[1](['node_modules/dep/Cargo.toml'], {}, makeContext(root));

    expect(results).toHaveLength(0);
  });

  it('ignores Cargo.toml under target dirs', async () => {
    const root = makeWorkspace({
      'target/debug/build/Cargo.toml': CRATE('generated'),
    });
    const results = await createNodesV2[1](
      ['target/debug/build/Cargo.toml'],
      {},
      makeContext(root),
    );

    expect(results).toHaveLength(0);
  });

  it('rejects a package name that is not a valid cargo name', async () => {
    const root = makeWorkspace({
      'evil/Cargo.toml': CRATE('x; rm -rf ~'),
    });
    const results = await createNodesV2[1](['evil/Cargo.toml'], {}, makeContext(root));

    expect(results).toHaveLength(0);
  });

  it('keeps output deterministic for unordered config files', async () => {
    const root = workspaceFixture();
    const [a, b] = await Promise.all([
      createNodes(root, WS_FILES),
      createNodes(root, WS_FILES.toReversed()),
    ]);
    expect(a).toEqual(b);
  });
});
