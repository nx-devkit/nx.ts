import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CreateNodesContextV2 } from 'nx/src/devkit-exports';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodesV2 } from './plugin.ts';

function makeContext(workspaceRoot: string): CreateNodesContextV2 {
  return {
    workspaceRoot,
    nxJsonConfiguration: {},
    turboConfig: undefined,
    projectGraph: { nodes: {}, dependencies: {} },
  } as unknown as CreateNodesContextV2;
}

const tempRoots: string[] = [];
afterEach(() => {
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function makeWorkspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-dotenv-'));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe('@nx-devkit/dotenv createNodesV2', () => {
  it('triggers on .env.example and .env.sample', () => {
    expect(createNodesV2[0]).toBe('**/{.env.example,.env.sample}');
  });

  it('infers a cacheable env:check target on the owning project', async () => {
    const root = makeWorkspace({ 'apps/api/.env.example': 'FOO=1\n' });
    const results = await createNodesV2[1](['apps/api/.env.example'], {}, makeContext(root));

    const project = results[0]![1].projects!['apps/api']!;
    const target = project.targets!['env:check']!;
    expect(target.executor).toBe('@nx-devkit/dotenv:check');
    expect(target.cache).toBe(true);
    expect(target.options).toEqual({ examples: ['apps/api/.env.example'] });
  });

  it('infers env:check on the root project for a workspace-root example', async () => {
    const root = makeWorkspace({ '.env.example': 'FOO=1\n' });
    const results = await createNodesV2[1](['.env.example'], {}, makeContext(root));

    expect(results).toHaveLength(1);
    const target = results[0]![1].projects!['']!.targets!['env:check']!;
    expect(target.options).toEqual({ examples: ['.env.example'] });
    expect(target.inputs).toContain('{workspaceRoot}/.env.example');
    expect(target.inputs).toContain('{workspaceRoot}/.env');
  });

  it('groups .env.example and .env.sample of one directory into a single target', async () => {
    const root = makeWorkspace({
      'pkg/.env.example': 'A=1\n',
      'pkg/.env.sample': 'B=1\n',
    });
    const results = await createNodesV2[1](
      ['pkg/.env.example', 'pkg/.env.sample'],
      {},
      makeContext(root),
    );

    expect(results).toHaveLength(1);
    const targets = results[0]![1].projects!.pkg!.targets!;
    expect(Object.keys(targets)).toEqual(['env:check']);
    expect(targets['env:check']!.options).toEqual({
      examples: ['pkg/.env.example', 'pkg/.env.sample'],
    });
  });

  it('adds the example file, the sibling .env and each required var as inputs', async () => {
    const root = makeWorkspace({ 'apps/api/.env.example': 'FOO=1\nexport BAR=2\n' });
    const results = await createNodesV2[1](['apps/api/.env.example'], {}, makeContext(root));

    const inputs = results[0]![1].projects!['apps/api']!.targets!['env:check']!.inputs!;
    expect(inputs).toContain('{projectRoot}/.env.example');
    expect(inputs).toContain('{projectRoot}/.env');
    expect(inputs).toContainEqual({ env: 'FOO' });
    expect(inputs).toContainEqual({ env: 'BAR' });
  });

  it('honors a custom targetName option', async () => {
    const root = makeWorkspace({ 'pkg/.env.example': 'FOO=1\n' });
    const results = await createNodesV2[1](
      ['pkg/.env.example'],
      { targetName: 'check-env' },
      makeContext(root),
    );

    const targets = results[0]![1].projects!.pkg!.targets!;
    expect(targets['check-env']).toBeDefined();
    expect(targets['env:check']).toBeUndefined();
  });

  it('normalizes a leading ./ in matched config paths', async () => {
    const root = makeWorkspace({ 'pkg/.env.example': 'FOO=1\n' });
    const results = await createNodesV2[1](['./pkg/.env.example'], {}, makeContext(root));

    const target = results[0]![1].projects!.pkg!.targets!['env:check']!;
    expect(target.options).toEqual({ examples: ['pkg/.env.example'] });
  });

  it('skips examples inside node_modules and outside the workspace', async () => {
    const root = makeWorkspace();
    const results = await createNodesV2[1](
      ['node_modules/x/.env.example', '../outside/.env.example'],
      {},
      makeContext(root),
    );
    expect(results).toHaveLength(0);
  });

  it('produces deterministic output regardless of input order', async () => {
    const root = makeWorkspace({
      'a/.env.example': 'A=1\n',
      'b/.env.sample': 'B=1\n',
    });
    const fwd = await createNodesV2[1](['a/.env.example', 'b/.env.sample'], {}, makeContext(root));
    const rev = await createNodesV2[1](['b/.env.sample', 'a/.env.example'], {}, makeContext(root));
    expect(fwd).toEqual(rev);
  });
});
