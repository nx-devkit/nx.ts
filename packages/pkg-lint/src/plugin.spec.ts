import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CreateNodesContextV2 } from 'nx/src/devkit-exports';
import { describe, expect, it } from 'vitest';
import { createNodesV2 } from './plugin.ts';

function makeContext(workspaceRoot: string): CreateNodesContextV2 {
  return {
    workspaceRoot,
    nxJsonConfiguration: {},
    turboConfig: undefined,
    projectGraph: { nodes: {}, dependencies: {} },
  } as unknown as CreateNodesContextV2;
}

function makeWorkspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-pkg-lint-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const PUBLISHABLE = '{"name":"a","exports":{".":"./dist/index.mjs"}}';

describe('@nx-devkit/pkg-lint createNodesV2', () => {
  it('globs every package.json', () => {
    expect(createNodesV2[0]).toBe('**/package.json');
  });

  it('infers a cached lint-pkg target on a publishable package.json', async () => {
    const root = makeWorkspace({ 'packages/a/package.json': PUBLISHABLE });
    const results = await createNodesV2[1](['packages/a/package.json'], {}, makeContext(root));

    expect(results).toHaveLength(1);
    const project = results[0]![1].projects!['packages/a']!;
    const target = project.targets!['lint-pkg']!;
    expect(target.executor).toBe('nx:run-commands');
    expect(target.cache).toBe(true);
    expect(target.options).toMatchObject({
      commands: ['npx publint', 'npx attw --pack'],
      parallel: false,
      cwd: '{projectRoot}',
    });
  });

  it('runs after build and caches on package.json + dist', async () => {
    const root = makeWorkspace({ 'packages/a/package.json': PUBLISHABLE });
    const results = await createNodesV2[1](['packages/a/package.json'], {}, makeContext(root));
    const target = results[0]![1].projects!['packages/a']!.targets!['lint-pkg']!;

    expect(target.dependsOn).toEqual(['build']);
    expect(target.inputs).toEqual(
      expect.arrayContaining(['{projectRoot}/package.json', '{projectRoot}/dist/**/*']),
    );
  });

  it.each([
    ['exports', '{"name":"a","exports":{".":"./dist/index.mjs"}}'],
    ['bin', '{"name":"a","bin":{"a":"./dist/cli.mjs"}}'],
    ['main + files', '{"name":"a","main":"./dist/index.cjs","files":["dist"]}'],
  ])('infers on publishable signal: %s', async (_label, manifest) => {
    const root = makeWorkspace({ 'packages/a/package.json': manifest });
    const results = await createNodesV2[1](['packages/a/package.json'], {}, makeContext(root));
    expect(results).toHaveLength(1);
  });

  it.each([
    ['name only', '{"name":"a"}'],
    ['main without files', '{"name":"a","main":"./dist/index.cjs"}'],
    ['private with exports', '{"name":"a","private":true,"exports":{".":"./dist/index.mjs"}}'],
    ['malformed JSON', '{oops'],
  ])('infers nothing on non-publishable manifest: %s', async (_label, manifest) => {
    const root = makeWorkspace({ 'packages/a/package.json': manifest });
    const results = await createNodesV2[1](['packages/a/package.json'], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });

  it('infers on a publishable workspace-root package.json', async () => {
    const root = makeWorkspace({ 'package.json': PUBLISHABLE });
    const results = await createNodesV2[1](['package.json'], {}, makeContext(root));

    const target = results[0]![1].projects!['']!.targets!['lint-pkg']!;
    expect(target.inputs).toEqual(
      expect.arrayContaining(['{workspaceRoot}/package.json', '{workspaceRoot}/dist/**/*']),
    );
  });

  it('skips the private workspace root', async () => {
    const root = makeWorkspace({ 'package.json': '{"name":"root","private":true}' });
    const results = await createNodesV2[1](['package.json'], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });

  it('skips manifests inside node_modules', async () => {
    const root = makeWorkspace({ 'node_modules/a/package.json': PUBLISHABLE });
    const results = await createNodesV2[1](['node_modules/a/package.json'], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });

  it('skips manifests that escape the workspace root', async () => {
    const root = makeWorkspace({});
    const outside = mkdtempSync(join(tmpdir(), 'nx-pkg-lint-outside-'));
    writeFileSync(join(outside, 'package.json'), PUBLISHABLE);
    const rel = `../${outside.split(/[\\/]/).pop()}/package.json`;
    const results = await createNodesV2[1]([rel], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });

  it('honors the publint/attw options', async () => {
    const root = makeWorkspace({ 'packages/a/package.json': PUBLISHABLE });

    const noPublint = await createNodesV2[1](
      ['packages/a/package.json'],
      { publint: false },
      makeContext(root),
    );
    expect(noPublint[0]![1].projects!['packages/a']!.targets!['lint-pkg']!.options).toMatchObject({
      commands: ['npx attw --pack'],
    });

    const noAttw = await createNodesV2[1](
      ['packages/a/package.json'],
      { attw: false },
      makeContext(root),
    );
    expect(noAttw[0]![1].projects!['packages/a']!.targets!['lint-pkg']!.options).toMatchObject({
      commands: ['npx publint'],
    });

    const none = await createNodesV2[1](
      ['packages/a/package.json'],
      { publint: false, attw: false },
      makeContext(root),
    );
    expect(none).toHaveLength(0);
  });

  it('honors the targetName option', async () => {
    const root = makeWorkspace({ 'packages/a/package.json': PUBLISHABLE });
    const results = await createNodesV2[1](
      ['packages/a/package.json'],
      { targetName: 'pkg-check' },
      makeContext(root),
    );
    const targets = results[0]![1].projects!['packages/a']!.targets!;
    expect(targets['pkg-check']).toBeDefined();
    expect(targets['lint-pkg']).toBeUndefined();
  });

  it('produces deterministic output regardless of input order', async () => {
    const root = makeWorkspace({
      'a/package.json': PUBLISHABLE,
      'b/package.json': PUBLISHABLE,
    });
    const fwd = await createNodesV2[1](['a/package.json', 'b/package.json'], {}, makeContext(root));
    const rev = await createNodesV2[1](['b/package.json', 'a/package.json'], {}, makeContext(root));
    expect(fwd).toEqual(rev);
  });
});

describe('publint on a fixture package', () => {
  const require = createRequire(import.meta.url);
  // Publint does not export ./package.json — resolve its entry, then walk up
  // to the manifest to read the bin field.
  let publintDir = dirname(require.resolve('publint'));
  while (publintDir !== dirname(publintDir)) {
    const candidate = join(publintDir, 'package.json');
    if (
      existsSync(candidate) &&
      (JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string }).name === 'publint'
    ) {
      break;
    }
    publintDir = dirname(publintDir);
  }
  const publintPkgJson = JSON.parse(readFileSync(join(publintDir, 'package.json'), 'utf8')) as {
    bin: string | Record<string, string>;
  };
  const publintBin = join(
    publintDir,
    typeof publintPkgJson.bin === 'string' ? publintPkgJson.bin : publintPkgJson.bin.publint!,
  );

  function runPublint(cwd: string): number {
    try {
      execFileSync(process.execPath, [publintBin], { cwd, stdio: 'pipe' });
      return 0;
    } catch (error) {
      return (error as { status?: number }).status ?? 1;
    }
  }

  it('fails on a package with a broken exports map', () => {
    const dir = makeWorkspace({
      'pkg/package.json': '{"name":"broken","version":"0.0.0","exports":{".":"./missing.mjs"}}',
    });
    expect(runPublint(join(dir, 'pkg'))).not.toBe(0);
  });

  it('passes on a well-formed package', () => {
    const dir = makeWorkspace({
      'pkg/package.json':
        '{"name":"ok","version":"0.0.0","exports":{".":{"types":"./dist/index.d.ts","default":"./dist/index.mjs"}},"files":["dist"]}',
      'pkg/dist/index.mjs': 'export const x = 1\n',
      'pkg/dist/index.d.ts': 'export declare const x: number\n',
    });
    expect(runPublint(join(dir, 'pkg'))).toBe(0);
  });
});
