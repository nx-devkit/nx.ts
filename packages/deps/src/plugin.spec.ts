import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
  const root = mkdtempSync(join(tmpdir(), 'nx-deps-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const MANYPKG_ROOT_PKG = JSON.stringify({
  name: 'mono',
  workspaces: ['packages/*'],
  devDependencies: { '@manypkg/cli': '^0.25.0' },
});

const SYNPACK_CONFIG_VARIANTS = [
  'syncpack.config.js',
  'syncpack.config.cjs',
  'syncpack.config.mjs',
  'syncpack.config.ts',
  '.syncpackrc',
  '.syncpackrc.json',
  '.syncpackrc.yaml',
  '.syncpackrc.yml',
  '.syncpackrc.js',
  '.syncpackrc.cjs',
  '.syncpackrc.mjs',
  '.syncpackrc.ts',
];

describe('@nx-devkit/deps createNodesV2', () => {
  it('triggers on the complete config glob', () => {
    expect(createNodesV2[0]).toBe(
      '**/{syncpack.config.{js,cjs,mjs,ts},.syncpackrc,.syncpackrc.{json,yaml,yml,js,cjs,mjs,ts},.manypkg.json,package.json,bun.lock,bun.lockb,package-lock.json,yarn.lock,pnpm-workspace.yaml,lerna.json,rush.json}',
    );
  });

  it.each(SYNPACK_CONFIG_VARIANTS)('infers deps:check for the %s variant', async (name) => {
    const root = makeWorkspace({ [name]: '{}' });
    const results = await createNodesV2[1]([name], {}, makeContext(root));
    expect(results[0]![1].projects!['']!.targets!['deps:check']).toBeDefined();
  });

  it('infers a cached deps:check via syncpack lint for a root syncpack config', async () => {
    const root = makeWorkspace({ 'syncpack.config.js': 'module.exports = {}' });
    const results = await createNodesV2[1](['syncpack.config.js'], {}, makeContext(root));
    const project = results[0]![1].projects!['']!;
    const target = project.targets!['deps:check']!;

    expect(target.executor).toBe('nx:run-commands');
    expect(target.cache).toBe(true);
    expect(target.options).toMatchObject({ command: 'npx syncpack lint', cwd: '{projectRoot}' });
    expect(target.inputs).toContain('{workspaceRoot}/**/package.json');
    expect(target.inputs).toContain('{workspaceRoot}/bun.lock');
    expect(target.inputs).toContain('{workspaceRoot}/syncpack.config.js');
  });

  it('infers an uncached deps:fix via syncpack fix', async () => {
    const root = makeWorkspace({ 'syncpack.config.ts': 'export default {}' });
    const results = await createNodesV2[1](['syncpack.config.ts'], {}, makeContext(root));
    const fix = results[0]![1].projects!['']!.targets!['deps:fix']!;

    expect(fix.cache).toBe(false);
    expect(fix.options).toMatchObject({ command: 'npx syncpack fix' });
  });

  it('infers on .syncpackrc variants', async () => {
    const root = makeWorkspace({ '.syncpackrc.json': '{}' });
    const results = await createNodesV2[1](['.syncpackrc.json'], {}, makeContext(root));
    expect(results[0]![1].projects!['']!.targets!['deps:check']).toBeDefined();
  });

  it('infers syncpack targets on a package.json carrying a "syncpack" key', async () => {
    const root = makeWorkspace({ 'package.json': '{"name":"x","syncpack":{}}' });
    const results = await createNodesV2[1](['package.json'], {}, makeContext(root));

    const targets = results[0]![1].projects!['']!.targets!;
    expect(targets['deps:check']!.options.command).toBe('npx syncpack lint');
    expect(targets['deps:fix']).toBeDefined();
  });

  it('falls back to manypkg check on a root package.json with workspaces + manypkg', async () => {
    const root = makeWorkspace({ 'package.json': MANYPKG_ROOT_PKG, 'bun.lock': '' });
    const results = await createNodesV2[1](['bun.lock', 'package.json'], {}, makeContext(root));

    const targets = results[0]![1].projects!['']!.targets!;
    expect(targets['deps:check']!.options.command).toBe('npx manypkg check');
    expect(targets['deps:check']!.cache).toBe(true);
    expect(targets['deps:fix']).toBeUndefined();
  });

  it('does not fall back to manypkg without a root lockfile/tool marker', async () => {
    // Manypkg cannot resolve a workspace without a root marker — no target.
    const root = makeWorkspace({ 'package.json': MANYPKG_ROOT_PKG });
    const results = await createNodesV2[1](['package.json'], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });

  it('does not infer any target for a root marker alone', async () => {
    const root = makeWorkspace({ 'bun.lock': '' });
    const results = await createNodesV2[1](['bun.lock'], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });

  it('does not fall back to manypkg on a nested package.json', async () => {
    const root = makeWorkspace({
      'bun.lock': '',
      'packages/a/package.json': MANYPKG_ROOT_PKG,
    });
    const results = await createNodesV2[1](
      ['bun.lock', 'packages/a/package.json'],
      {},
      makeContext(root),
    );
    expect(results).toHaveLength(0);
  });

  it('does not fall back to manypkg on a nested .manypkg.json', async () => {
    const root = makeWorkspace({ 'bun.lock': '', 'packages/a/.manypkg.json': '{}' });
    const results = await createNodesV2[1](
      ['bun.lock', 'packages/a/.manypkg.json'],
      {},
      makeContext(root),
    );
    expect(results).toHaveLength(0);
  });

  it('does not fall back to manypkg without workspaces', async () => {
    const root = makeWorkspace({
      'package.json': '{"name":"x","devDependencies":{"manypkg":"^0.25.0"}}',
      'bun.lock': '',
    });
    const results = await createNodesV2[1](['bun.lock', 'package.json'], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });

  it('does not fall back to manypkg without a manypkg dep', async () => {
    const root = makeWorkspace({
      'package.json': '{"name":"x","workspaces":["packages/*"]}',
      'bun.lock': '',
    });
    const results = await createNodesV2[1](['bun.lock', 'package.json'], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });

  it('falls back to manypkg check on a root .manypkg.json with a root marker', async () => {
    const root = makeWorkspace({ '.manypkg.json': '{}', 'yarn.lock': '' });
    const results = await createNodesV2[1](['.manypkg.json', 'yarn.lock'], {}, makeContext(root));

    const targets = results[0]![1].projects!['']!.targets!;
    expect(targets['deps:check']!.options.command).toBe('npx manypkg check');
    expect(targets['deps:fix']).toBeUndefined();
  });

  it('prefers syncpack over manypkg when both signals exist at the root', async () => {
    const root = makeWorkspace({
      'package.json': MANYPKG_ROOT_PKG,
      'bun.lock': '',
      'syncpack.config.js': 'module.exports = {}',
    });
    const results = await createNodesV2[1](
      ['package.json', 'bun.lock', 'syncpack.config.js'],
      {},
      makeContext(root),
    );

    expect(results).toHaveLength(1);
    const targets = results[0]![1].projects!['']!.targets!;
    expect(targets['deps:check']!.options.command).toBe('npx syncpack lint');
    expect(targets['deps:fix']).toBeDefined();
    // The manypkg-bearing manifest is still an input so edits bust the cache.
    expect(targets['deps:check']!.inputs).toContain('{workspaceRoot}/package.json');
  });

  it('honors checkTargetName, fixTargetName and fixTarget options', async () => {
    const root = makeWorkspace({ '.syncpackrc': '{}' });
    const results = await createNodesV2[1](
      ['.syncpackrc'],
      { checkTargetName: 'deps:lint', fixTargetName: 'deps:repair', fixTarget: true },
      makeContext(root),
    );
    const targets = results[0]![1].projects!['']!.targets!;
    expect(targets['deps:lint']).toBeDefined();
    expect(targets['deps:repair']).toBeDefined();

    const noFix = await createNodesV2[1](['.syncpackrc'], { fixTarget: false }, makeContext(root));
    expect(noFix[0]![1].projects!['']!.targets!['deps:fix']).toBeUndefined();
  });

  it('infers syncpack targets on a nested config directory', async () => {
    const root = makeWorkspace({ 'packages/a/.syncpackrc.json': '{}' });
    const results = await createNodesV2[1](['packages/a/.syncpackrc.json'], {}, makeContext(root));

    const project = results[0]![1].projects!['packages/a']!;
    expect(project.targets!['deps:check']!.options).toMatchObject({ cwd: '{projectRoot}' });
    expect(project.targets!['deps:check']!.inputs).toContain('{projectRoot}/**/package.json');
  });

  it('skips configs inside node_modules', async () => {
    const root = makeWorkspace({ 'node_modules/x/.syncpackrc': '{}' });
    const results = await createNodesV2[1](['node_modules/x/.syncpackrc'], {}, makeContext(root));
    expect(results).toHaveLength(0);
  });

  it('produces deterministic output regardless of input order', async () => {
    const root = makeWorkspace({ 'a/.syncpackrc': '{}', 'b/.syncpackrc': '{}' });
    const fwd = await createNodesV2[1](['a/.syncpackrc', 'b/.syncpackrc'], {}, makeContext(root));
    const rev = await createNodesV2[1](['b/.syncpackrc', 'a/.syncpackrc'], {}, makeContext(root));
    expect(fwd).toEqual(rev);
  });
});
