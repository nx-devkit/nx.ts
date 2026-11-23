import { vol } from 'memfs';
import type { CreateNodesContextV2 } from 'nx/src/devkit-exports';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNodesV2 } from './plugin.ts';

vi.mock('fs', async () => {
  const memfs = await import('memfs');
  return { ...memfs.fs, default: memfs.fs };
});

vi.mock('node:fs', async () => {
  const memfs = await import('memfs');
  return { ...memfs.fs, default: memfs.fs };
});

vi.mock('fs/promises', async () => {
  const memfs = await import('memfs');
  return { ...memfs.fs.promises, default: memfs.fs.promises };
});

function makeContext(): CreateNodesContextV2 {
  return {
    workspaceRoot: '/workspace',
    nxJsonConfiguration: {},
    turboConfig: undefined,
    projectGraph: { nodes: {}, dependencies: {} },
  } as unknown as CreateNodesContextV2;
}

describe('@nx-devkit/boundaries createNodesV2', () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NX_VERBOSE_LOGGING;
  });

  it('infers a root check-boundaries target when a project declares nx.tags', async () => {
    vol.fromJSON(
      {
        '/workspace/package.json': '{"name":"root"}',
        '/workspace/packages/app/package.json': '{"name":"app","nx":{"tags":["type:app"]}}',
      },
      '/',
    );
    const results = await createNodesV2[1](
      ['package.json', 'packages/app/package.json'],
      {},
      makeContext(),
    );
    const rootEntry = results.find(([f]) => f === 'package.json');
    expect(rootEntry).toBeDefined();
    const root = rootEntry![1].projects!['.']!;
    expect(root.targets).toHaveProperty('check-boundaries');
    expect(root.targets!['check-boundaries']!.executor).toBe(
      '@nx-devkit/boundaries:check-boundaries',
    );
    // The root aggregate scans every project — no `project` option.
    expect(root.targets!['check-boundaries']!.options).not.toHaveProperty('project');
  });

  it('infers a per-project check-boundaries target on each tagged project', async () => {
    vol.fromJSON(
      {
        '/workspace/package.json': '{"name":"root"}',
        '/workspace/apps/web/package.json': '{"name":"@acme/web","nx":{"tags":["type:app"]}}',
        '/workspace/libs/util/package.json': '{"name":"@acme/util","nx":{"tags":["type:util"]}}',
      },
      '/',
    );
    const results = await createNodesV2[1](
      ['package.json', 'apps/web/package.json', 'libs/util/package.json'],
      {},
      makeContext(),
    );
    const web = results.find(([f]) => f === 'apps/web/package.json');
    const util = results.find(([f]) => f === 'libs/util/package.json');
    expect(web).toBeDefined();
    expect(util).toBeDefined();

    const webTarget = web![1].projects!['apps/web']!.targets!['check-boundaries']!;
    expect(webTarget.executor).toBe('@nx-devkit/boundaries:check-boundaries');
    expect(webTarget.cache).toBe(true);
    // Per-project targets are scoped — nx affected only reruns impacted checks.
    expect(webTarget.options).toMatchObject({ project: '@acme/web' });
    expect(webTarget.inputs).toContain('{projectRoot}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}');
    expect(webTarget.inputs).toContain('{workspaceRoot}/**/package.json');

    expect(util![1].projects!['libs/util']!.targets!['check-boundaries']!.options).toMatchObject({
      project: '@acme/util',
    });
  });

  it('keeps the root aggregate alongside per-project targets', async () => {
    vol.fromJSON(
      {
        '/workspace/package.json': '{"name":"root"}',
        '/workspace/apps/web/package.json': '{"name":"@acme/web","nx":{"tags":["type:app"]}}',
      },
      '/',
    );
    const results = await createNodesV2[1](
      ['package.json', 'apps/web/package.json'],
      {},
      makeContext(),
    );
    const files = results.map(([f]) => f);
    expect(files).toEqual(expect.arrayContaining(['package.json', 'apps/web/package.json']));
  });

  it('infers tags from the directory layout — zero-config targets without nx.tags', async () => {
    vol.fromJSON(
      {
        '/workspace/package.json': '{"name":"root"}',
        '/workspace/apps/web/package.json': '{"name":"@acme/web"}',
      },
      '/',
    );
    const results = await createNodesV2[1](
      ['package.json', 'apps/web/package.json'],
      {},
      makeContext(),
    );
    const web = results.find(([f]) => f === 'apps/web/package.json');
    expect(web).toBeDefined();
    expect(web![1].projects!['apps/web']!.targets).toHaveProperty('check-boundaries');
    // The inferred tags are resolved at run time — the executor gets inferTags.
    expect(web![1].projects!['apps/web']!.targets!['check-boundaries']!.options).toMatchObject({
      inferTags: true,
    });
    // Root aggregate exists too.
    expect(results.find(([f]) => f === 'package.json')).toBeDefined();
  });

  it('emits no targets for untagged projects when inferTags is false', async () => {
    vol.fromJSON(
      {
        '/workspace/package.json': '{"name":"root"}',
        '/workspace/packages/app/package.json': '{"name":"app"}',
      },
      '/',
    );
    const results = await createNodesV2[1](
      ['package.json', 'packages/app/package.json'],
      { inferTags: false },
      makeContext(),
    );
    expect(results).toHaveLength(0);
  });

  it('still tags only explicitly-tagged projects when inferTags is false', async () => {
    vol.fromJSON(
      {
        '/workspace/package.json': '{"name":"root"}',
        '/workspace/apps/web/package.json': '{"name":"@acme/web","nx":{"tags":["type:app"]}}',
        '/workspace/libs/misc/package.json': '{"name":"@acme/misc"}',
      },
      '/',
    );
    const results = await createNodesV2[1](
      ['package.json', 'apps/web/package.json', 'libs/misc/package.json'],
      { inferTags: false },
      makeContext(),
    );
    const files = results.map(([f]) => f).sort();
    // Root aggregate + the one tagged project; misc stays untouched (untagged
    // sources are permissive — a target on it would be a vacuous pass).
    expect(files).toEqual(['apps/web/package.json', 'package.json']);
  });

  it('a root package.json alone does not trigger any target', async () => {
    vol.fromJSON({ '/workspace/package.json': '{"name":"root","nx":{"tags":["type:app"]}}' }, '/');
    const results = await createNodesV2[1](['package.json'], {}, makeContext());
    expect(results).toHaveLength(0);
  });

  it('passes depConstraints and checkCircularDependencies through to the target options', async () => {
    vol.fromJSON(
      {
        '/workspace/package.json': '{"name":"root"}',
        '/workspace/packages/app/package.json': '{"name":"app","nx":{"tags":["type:app"]}}',
      },
      '/',
    );
    const depConstraints = [{ sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:util'] }];
    const results = await createNodesV2[1](
      ['package.json', 'packages/app/package.json'],
      { depConstraints, checkCircularDependencies: false },
      makeContext(),
    );
    const rootEntry = results.find(([f]) => f === 'package.json')!;
    expect(rootEntry[1].projects!['.']!.targets!['check-boundaries']!.options).toEqual(
      expect.objectContaining({ depConstraints, checkCircularDependencies: false }),
    );
    const appEntry = results.find(([f]) => f === 'packages/app/package.json')!;
    expect(appEntry[1].projects!['packages/app']!.targets!['check-boundaries']!.options).toEqual(
      expect.objectContaining({ depConstraints, project: 'app' }),
    );
  });

  it('honors a custom targetName', async () => {
    vol.fromJSON(
      {
        '/workspace/package.json': '{"name":"root"}',
        '/workspace/packages/app/package.json': '{"name":"app","nx":{"tags":["t"]}}',
      },
      '/',
    );
    const results = await createNodesV2[1](
      ['package.json', 'packages/app/package.json'],
      { targetName: 'boundaries' },
      makeContext(),
    );
    for (const [, project] of results) {
      for (const node of Object.values(project.projects!)) {
        expect(node.targets).toHaveProperty('boundaries');
      }
    }
  });

  it('derives the per-project name from nx.name, else package name, else directory', async () => {
    vol.fromJSON(
      {
        '/workspace/package.json': '{"name":"root"}',
        '/workspace/libs/renamed/package.json':
          '{"name":"pkg","nx":{"name":"nx-renamed","tags":["t"]}}',
        '/workspace/libs/unnamed/package.json': '{"nx":{"tags":["t"]}}',
      },
      '/',
    );
    const results = await createNodesV2[1](
      ['package.json', 'libs/renamed/package.json', 'libs/unnamed/package.json'],
      {},
      makeContext(),
    );
    const renamed = results.find(([f]) => f === 'libs/renamed/package.json')!;
    const unnamed = results.find(([f]) => f === 'libs/unnamed/package.json')!;
    expect(
      renamed[1].projects!['libs/renamed']!.targets!['check-boundaries']!.options,
    ).toMatchObject({ project: 'nx-renamed' });
    expect(
      unnamed[1].projects!['libs/unnamed']!.targets!['check-boundaries']!.options,
    ).toMatchObject({ project: 'unnamed' });
  });
});
