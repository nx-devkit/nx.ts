import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname as pathDirname, join } from 'node:path';
import { logger, type ExecutorContext, type ProjectGraph } from '@nx/devkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import checkBoundaries from './executor.ts';

interface ProjectFixture {
  name: string;
  root: string;
  tags: string[];
  files: Record<string, string>;
}

let root: string;

function scaffold(
  projects: ProjectFixture[],
  deps: Record<string, string[]> = {},
): ExecutorContext {
  const nodes: ProjectGraph['nodes'] = {};
  const dependencies: ProjectGraph['dependencies'] = {};
  for (const p of projects) {
    const dir = join(root, p.root);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify(p.tags.length > 0 ? { name: p.name, nx: { tags: p.tags } } : { name: p.name }),
    );
    for (const [file, content] of Object.entries(p.files)) {
      const abs = join(dir, file);
      mkdirSync(pathDirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    nodes[p.name] = {
      name: p.name,
      type: 'lib',
      data: { root: p.root, name: p.name, tags: p.tags, metadata: { js: { packageName: p.name } } },
    } as ProjectGraph['nodes'][string];
    dependencies[p.name] = (deps[p.name] ?? []).map((target) => ({
      source: p.name,
      target,
      type: 'static' as never,
    }));
  }
  const graph: ProjectGraph = { nodes, dependencies };
  return {
    root,
    projectGraph: graph,
    nxJsonConfiguration: {},
    cwd: root,
    isVerbose: false,
  } as unknown as ExecutorContext;
}

const CONSTRAINTS = [
  { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:feature', 'type:util'] },
  { sourceTag: 'type:feature', onlyDependOnLibsWithTags: ['type:util'] },
];

describe('check-boundaries executor', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nxdevkit-boundaries-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('passes when all imports satisfy the constraints', async () => {
    const ctx = scaffold([
      {
        name: '@acme/app',
        root: 'apps/app',
        tags: ['type:app'],
        files: { 'src/main.ts': "import { u } from '@acme/util'\n" },
      },
      {
        name: '@acme/util',
        root: 'libs/util',
        tags: ['type:util'],
        files: { 'src/index.ts': 'export const u = 1\n' },
      },
    ]);
    const res = await checkBoundaries({ depConstraints: CONSTRAINTS }, ctx);
    expect(res.success).toBe(true);
  });

  it('fails with file:line on a forbidden edge', async () => {
    const ctx = scaffold([
      {
        name: '@acme/feature',
        root: 'libs/feature',
        tags: ['type:feature'],
        files: { 'src/index.ts': "import { a } from '@acme/app'\n" },
      },
      {
        name: '@acme/app',
        root: 'apps/app',
        tags: ['type:app'],
        files: { 'src/main.ts': 'export const a = 1\n' },
      },
    ]);
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await checkBoundaries({ depConstraints: CONSTRAINTS }, ctx);
    expect(res.success).toBe(false);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining(
        'libs/feature/src/index.ts:1 — @acme/feature (type:feature) cannot depend on @acme/app (type:app) via "@acme/app"',
      ),
    );
    spy.mockRestore();
  });

  it('resolves relative cross-project imports', async () => {
    const ctx = scaffold([
      {
        name: 'feature',
        root: 'libs/feature',
        tags: ['type:feature'],
        files: { 'src/index.ts': "import { a } from '../../../apps/app/src/main'\n" },
      },
      {
        name: 'app',
        root: 'apps/app',
        tags: ['type:app'],
        files: { 'src/main.ts': 'export const a = 1\n' },
      },
    ]);
    const res = await checkBoundaries({ depConstraints: CONSTRAINTS }, ctx);
    expect(res.success).toBe(false);
  });

  it('allows imports when no constraint matches the source tags', async () => {
    const ctx = scaffold([
      {
        name: 'misc',
        root: 'libs/misc',
        tags: ['scope:other'],
        files: { 'src/index.ts': "import { a } from '@acme/app'\n" },
      },
      {
        name: '@acme/app',
        root: 'apps/app',
        tags: ['type:app'],
        files: { 'src/main.ts': 'export const a = 1\n' },
      },
    ]);
    const res = await checkBoundaries({ depConstraints: CONSTRAINTS }, ctx);
    expect(res.success).toBe(true);
  });

  it('allows self-imports regardless of constraints', async () => {
    const ctx = scaffold([
      {
        name: '@acme/app',
        root: 'apps/app',
        tags: ['type:app'],
        files: {
          'src/main.ts': "import { b } from './b'\n",
          'src/b.ts': 'export const b = 1\n',
        },
      },
    ]);
    const res = await checkBoundaries({ depConstraints: CONSTRAINTS }, ctx);
    expect(res.success).toBe(true);
  });

  it('resolves tsconfig paths mappings', async () => {
    writeFileSync(
      join(root, 'tsconfig.base.json'),
      JSON.stringify({ compilerOptions: { paths: { '@acme/*': ['libs/*/src'] } } }),
    );
    const ctx = scaffold([
      {
        name: 'feature',
        root: 'libs/feature',
        tags: ['type:feature'],
        files: { 'src/index.ts': "import { u } from '@acme/util'\n" },
      },
      {
        name: 'util',
        root: 'libs/util',
        tags: ['type:util'],
        files: { 'src/index.ts': 'export const u = 1\n' },
      },
    ]);
    const res = await checkBoundaries({ depConstraints: CONSTRAINTS }, ctx);
    expect(res.success).toBe(true);
  });

  it('ignores external npm imports', async () => {
    const ctx = scaffold([
      {
        name: '@acme/feature',
        root: 'libs/feature',
        tags: ['type:feature'],
        files: { 'src/index.ts': "import lodash from 'lodash'\n" },
      },
    ]);
    const res = await checkBoundaries({ depConstraints: CONSTRAINTS }, ctx);
    expect(res.success).toBe(true);
  });

  it('skips files owned by a nested project during the parent scan', async () => {
    const ctx = scaffold([
      {
        name: '@acme/feature',
        root: 'libs/feature',
        tags: ['type:feature'],
        files: { 'src/index.ts': 'export const f = 1\n' },
      },
      {
        name: '@acme/nested',
        root: 'libs/feature/nested',
        tags: ['type:app'],
        // Relative self-import resolves to the nested project — under the
        // parent's scan it would false-positive as a type:feature→type:app edge.
        files: {
          'src/x.ts': "import { y } from './y'\n",
          'src/y.ts': 'export const y = 1\n',
        },
      },
    ]);
    const res = await checkBoundaries({ depConstraints: CONSTRAINTS }, ctx);
    expect(res.success).toBe(true);
  });

  it('attributes nested-project violations to the nested project', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const ctx = scaffold([
        {
          name: '@acme/root-app',
          root: 'apps/root-app',
          tags: ['type:app'],
          files: { 'src/main.ts': 'export const a = 1\n' },
        },
        {
          name: '@acme/app',
          root: 'apps/app',
          tags: ['type:app'],
          files: { 'src/main.ts': 'export const a = 1\n' },
        },
        {
          name: '@acme/nested',
          root: 'apps/root-app/nested',
          tags: ['type:feature'],
          // Imports @acme/app (type:app) — under the parent's type:app scan this
          // edge is also forbidden (type:app may not depend on type:app), so a
          // missing owner-skip would report it under root-app's name too.
          files: { 'src/x.ts': "import { a } from '@acme/app'\n" },
        },
      ]);
      const res = await checkBoundaries({ depConstraints: CONSTRAINTS }, ctx);
      expect(res.success).toBe(false);
      // Only the owning nested project may report this edge; the parent must not.
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('@acme/nested (type:feature)'));
      expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('@acme/root-app ('));
    } finally {
      spy.mockRestore();
    }
  });

  it('fails on notDependOnLibsWithTags', async () => {
    const ctx = scaffold([
      {
        name: '@acme/app',
        root: 'apps/app',
        tags: ['type:app'],
        files: { 'src/main.ts': "import { e } from '@acme/e2e'\n" },
      },
      {
        name: '@acme/e2e',
        root: 'e2e/e2e',
        tags: ['type:e2e'],
        files: { 'src/index.ts': 'export const e = 1\n' },
      },
    ]);
    const res = await checkBoundaries(
      {
        depConstraints: [{ sourceTag: 'type:*', notDependOnLibsWithTags: ['type:e2e'] }],
      },
      ctx,
    );
    expect(res.success).toBe(false);
  });

  it('fails on a banned external dependency', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const ctx = scaffold([
        {
          name: '@acme/app',
          root: 'apps/app',
          tags: ['type:app'],
          files: { 'src/main.ts': "import fs from 'fs-extra'\n" },
        },
      ]);
      const res = await checkBoundaries(
        {
          depConstraints: [{ sourceTag: 'type:app', bannedExternalDeps: ['fs-extra'] }],
        },
        ctx,
      );
      expect(res.success).toBe(false);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('fs-extra'));
    } finally {
      spy.mockRestore();
    }
  });

  it('fails on an external dependency outside allowedExternalDeps', async () => {
    const ctx = scaffold([
      {
        name: '@acme/app',
        root: 'apps/app',
        tags: ['type:app'],
        files: { 'src/main.ts': "import _ from 'lodash'\nimport react from 'react'\n" },
      },
    ]);
    const res = await checkBoundaries(
      { depConstraints: [{ sourceTag: 'type:app', allowedExternalDeps: ['react'] }] },
      ctx,
    );
    expect(res.success).toBe(false);
  });

  it('allows listed external dependencies and node builtins', async () => {
    const ctx = scaffold([
      {
        name: '@acme/app',
        root: 'apps/app',
        tags: ['type:app'],
        files: {
          'src/main.ts':
            "import react from 'react'\nimport path from 'node:path'\nimport fs from 'fs'\n",
        },
      },
    ]);
    const res = await checkBoundaries(
      { depConstraints: [{ sourceTag: 'type:app', allowedExternalDeps: ['react'] }] },
      ctx,
    );
    expect(res.success).toBe(true);
  });

  it('detects circular dependencies from the project graph', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const ctx = scaffold(
        [
          { name: 'a', root: 'libs/a', tags: ['type:lib'], files: { 'src/a.ts': '' } },
          { name: 'b', root: 'libs/b', tags: ['type:lib'], files: { 'src/b.ts': '' } },
        ],
        { a: ['b'], b: ['a'] },
      );
      const res = await checkBoundaries({ depConstraints: [] }, ctx);
      expect(res.success).toBe(false);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('circular dependency: a -> b -> a'));
    } finally {
      spy.mockRestore();
    }
  });

  it('skips circular detection when checkCircularDependencies is false', async () => {
    const ctx = scaffold(
      [
        { name: 'a', root: 'libs/a', tags: ['type:lib'], files: { 'src/a.ts': '' } },
        { name: 'b', root: 'libs/b', tags: ['type:lib'], files: { 'src/b.ts': '' } },
      ],
      { a: ['b'], b: ['a'] },
    );
    const res = await checkBoundaries(
      { depConstraints: [], checkCircularDependencies: false },
      ctx,
    );
    expect(res.success).toBe(true);
  });

  it('checks only the named project when options.project is set', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const ctx = scaffold([
        {
          name: '@acme/feature',
          root: 'libs/feature',
          tags: ['type:feature'],
          files: { 'src/index.ts': "import { a } from '@acme/app'\n" },
        },
        {
          name: '@acme/other',
          root: 'libs/other',
          tags: ['type:feature'],
          files: { 'src/index.ts': "import { a } from '@acme/app'\n" },
        },
        {
          name: '@acme/app',
          root: 'apps/app',
          tags: ['type:app'],
          files: { 'src/main.ts': 'export const a = 1\n' },
        },
      ]);
      const res = await checkBoundaries(
        { depConstraints: CONSTRAINTS, project: '@acme/feature' },
        ctx,
      );
      expect(res.success).toBe(false);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('@acme/feature (type:feature)'));
      expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('@acme/other ('));
    } finally {
      spy.mockRestore();
    }
  });

  it('passes the named project when only other projects violate', async () => {
    const ctx = scaffold([
      {
        name: '@acme/clean',
        root: 'libs/clean',
        tags: ['type:feature'],
        files: { 'src/index.ts': "import { u } from '@acme/util'\n" },
      },
      {
        name: '@acme/dirty',
        root: 'libs/dirty',
        tags: ['type:feature'],
        files: { 'src/index.ts': "import { a } from '@acme/app'\n" },
      },
      {
        name: '@acme/app',
        root: 'apps/app',
        tags: ['type:app'],
        files: { 'src/main.ts': 'export const a = 1\n' },
      },
      {
        name: '@acme/util',
        root: 'libs/util',
        tags: ['type:util'],
        files: { 'src/index.ts': 'export const u = 1\n' },
      },
    ]);
    const res = await checkBoundaries({ depConstraints: CONSTRAINTS, project: '@acme/clean' }, ctx);
    expect(res.success).toBe(true);
  });

  it('filters circular reports to cycles containing the named project', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const ctx = scaffold(
        [
          { name: 'a', root: 'libs/a', tags: ['t'], files: { 'src/a.ts': '' } },
          { name: 'b', root: 'libs/b', tags: ['t'], files: { 'src/b.ts': '' } },
          { name: 'x', root: 'libs/x', tags: ['t'], files: { 'src/x.ts': '' } },
          { name: 'y', root: 'libs/y', tags: ['t'], files: { 'src/y.ts': '' } },
        ],
        { a: ['b'], b: ['a'], x: ['y'], y: ['x'] },
      );
      const res = await checkBoundaries({ depConstraints: [], project: 'a' }, ctx);
      expect(res.success).toBe(false);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('a -> b -> a'));
      expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('x -> y -> x'));

      const resY = await checkBoundaries({ depConstraints: [], project: 'y' }, ctx);
      expect(resY.success).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('throws for an unknown project option', async () => {
    const ctx = scaffold([{ name: 'a', root: 'libs/a', tags: ['t'], files: { 'src/a.ts': '' } }]);
    await expect(
      checkBoundaries({ depConstraints: [], project: 'does-not-exist' }, ctx),
    ).rejects.toThrow('does-not-exist');
  });

  it('emits machine-readable JSON when format is json', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const ctx = scaffold([
        {
          name: '@acme/feature',
          root: 'libs/feature',
          tags: ['type:feature'],
          files: { 'src/index.ts': "import { a } from '@acme/app'\n" },
        },
        {
          name: '@acme/app',
          root: 'apps/app',
          tags: ['type:app'],
          files: { 'src/main.ts': 'export const a = 1\n' },
        },
      ]);
      const res = await checkBoundaries({ depConstraints: CONSTRAINTS, format: 'json' }, ctx);
      expect(res.success).toBe(false);
      const json = write.mock.calls.map((c) => String(c[0])).join('');
      const parsed = JSON.parse(json) as {
        success: boolean;
        violations: { kind: string; file: string; source: string; target: string }[];
      };
      expect(parsed.success).toBe(false);
      expect(parsed.violations[0]).toMatchObject({
        kind: 'constraint',
        file: 'libs/feature/src/index.ts',
        source: '@acme/feature',
        target: '@acme/app',
      });
    } finally {
      write.mockRestore();
    }
  });

  it('emits a mermaid graph when format is mermaid', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const ctx = scaffold([
        {
          name: '@acme/feature',
          root: 'libs/feature',
          tags: ['type:feature'],
          files: { 'src/index.ts': "import { a } from '@acme/app'\n" },
        },
        {
          name: '@acme/app',
          root: 'apps/app',
          tags: ['type:app'],
          files: { 'src/main.ts': 'export const a = 1\n' },
        },
      ]);
      const res = await checkBoundaries({ depConstraints: CONSTRAINTS, format: 'mermaid' }, ctx);
      expect(res.success).toBe(false);
      const out = write.mock.calls.map((c) => String(c[0])).join('');
      expect(out).toContain('graph LR');
      expect(out).toContain('"@acme/feature"');
      expect(out).toContain('"@acme/app"');
    } finally {
      write.mockRestore();
    }
  });

  it('infers tags from directory layout for untagged projects', async () => {
    const ctx = scaffold([
      {
        name: '@acme/web',
        root: 'apps/web',
        tags: [],
        files: { 'src/main.ts': "import { a } from '@acme/app'\n" },
      },
      {
        name: '@acme/app',
        root: 'apps/app',
        tags: ['type:app'],
        files: { 'src/main.ts': 'export const a = 1\n' },
      },
    ]);
    // apps/web infers type:app → the type:app constraint applies → violation.
    const res = await checkBoundaries({ depConstraints: CONSTRAINTS }, ctx);
    expect(res.success).toBe(false);
    // With inference off the untagged project stays permissive.
    const resOff = await checkBoundaries({ depConstraints: CONSTRAINTS, inferTags: false }, ctx);
    expect(resOff.success).toBe(true);
  });
});
