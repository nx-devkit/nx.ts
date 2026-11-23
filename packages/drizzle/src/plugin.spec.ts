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
  const root = mkdtempSync(join(tmpdir(), 'nx-drizzle-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe('@nx-devkit/drizzle createNodesV2', () => {
  it('triggers on drizzle.config files', () => {
    expect(createNodesV2[0]).toBe('**/drizzle.config.{ts,js,mts,mjs,cjs,cts}');
  });

  it('infers all five db targets on the owning project', async () => {
    const root = makeWorkspace({ 'packages/db/drizzle.config.ts': 'export default {}' });
    const results = await createNodesV2[1](
      ['packages/db/drizzle.config.ts'],
      {},
      makeContext(root),
    );

    const project = results[0]![1].projects!['packages/db']!;
    const targets = project.targets!;
    expect(Object.keys(targets).sort()).toEqual([
      'db:check',
      'db:generate',
      'db:migrate',
      'db:push',
      'db:studio',
    ]);
  });

  it('db:generate is cached and runs drizzle-kit generate', async () => {
    const root = makeWorkspace({ 'packages/db/drizzle.config.ts': 'export default {}' });
    const results = await createNodesV2[1](
      ['packages/db/drizzle.config.ts'],
      {},
      makeContext(root),
    );
    const target = results[0]![1].projects!['packages/db']!.targets!['db:generate']!;

    expect(target.executor).toBe('nx:run-commands');
    expect(target.options).toEqual({
      command: 'npx drizzle-kit generate',
      cwd: '{projectRoot}',
    });
    expect(target.cache).toBe(true);
    expect(target.inputs).toEqual(
      expect.arrayContaining(['{projectRoot}/**/*', '{projectRoot}/drizzle.config.ts']),
    );
    expect(target.outputs).toContain('{projectRoot}/drizzle');
  });

  it('db:check is cached and runs drizzle-kit check', async () => {
    const root = makeWorkspace({ 'packages/db/drizzle.config.ts': 'export default {}' });
    const results = await createNodesV2[1](
      ['packages/db/drizzle.config.ts'],
      {},
      makeContext(root),
    );
    const target = results[0]![1].projects!['packages/db']!.targets!['db:check']!;

    expect(target.executor).toBe('nx:run-commands');
    expect(target.options).toEqual({ command: 'npx drizzle-kit check', cwd: '{projectRoot}' });
    expect(target.cache).toBe(true);
  });

  it('db:migrate, db:push, db:studio are never cached', async () => {
    const root = makeWorkspace({ 'packages/db/drizzle.config.ts': 'export default {}' });
    const results = await createNodesV2[1](
      ['packages/db/drizzle.config.ts'],
      {},
      makeContext(root),
    );
    const targets = results[0]![1].projects!['packages/db']!.targets!;

    expect(targets['db:migrate']!.cache).toBe(false);
    expect(targets['db:migrate']!.options).toEqual({
      command: 'npx drizzle-kit migrate',
      cwd: '{projectRoot}',
    });
    expect(targets['db:push']!.cache).toBe(false);
    expect(targets['db:push']!.options).toEqual({
      command: 'npx drizzle-kit push',
      cwd: '{projectRoot}',
    });
    expect(targets['db:studio']!.cache).toBe(false);
    expect(targets['db:studio']!.options).toEqual({
      command: 'npx drizzle-kit studio',
      cwd: '{projectRoot}',
    });
  });

  it('db:migrate depends on db:check so migrations are validated first', async () => {
    const root = makeWorkspace({ 'packages/db/drizzle.config.ts': 'export default {}' });
    const results = await createNodesV2[1](
      ['packages/db/drizzle.config.ts'],
      {},
      makeContext(root),
    );
    const migrate = results[0]![1].projects!['packages/db']!.targets!['db:migrate']!;
    expect(migrate.dependsOn).toEqual(['db:check']);
  });

  it('never interpolates credentials — no target option references env vars or connection strings', async () => {
    const root = makeWorkspace({ 'packages/db/drizzle.config.ts': 'export default {}' });
    const results = await createNodesV2[1](
      ['packages/db/drizzle.config.ts'],
      {},
      makeContext(root),
    );
    const serialized = JSON.stringify(results[0]![1]);
    expect(serialized).not.toMatch(/DATABASE_URL/i);
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//i);
  });

  it('infers targets on the root project for a workspace-root config', async () => {
    const root = makeWorkspace({ 'drizzle.config.ts': 'export default {}' });
    const results = await createNodesV2[1](['drizzle.config.ts'], {}, makeContext(root));

    expect(results).toHaveLength(1);
    const targets = results[0]![1].projects!['']!.targets!;
    expect(targets['db:generate']).toBeDefined();
    expect(targets['db:generate']!.inputs).toContain('{workspaceRoot}/drizzle.config.ts');
  });

  it('groups several configs in one directory into a single target set', async () => {
    const root = makeWorkspace({
      'a/drizzle.config.ts': 'export default {}',
      'a/drizzle.config.js': 'export default {}',
    });
    const results = await createNodesV2[1](
      ['a/drizzle.config.ts', 'a/drizzle.config.js'],
      {},
      makeContext(root),
    );

    expect(results).toHaveLength(1);
    const targets = results[0]![1].projects!.a!.targets!;
    expect(Object.keys(targets).sort()).toEqual([
      'db:check',
      'db:generate',
      'db:migrate',
      'db:push',
      'db:studio',
    ]);
    expect(targets['db:generate']!.inputs).toContain('{projectRoot}/drizzle.config.js');
  });

  it('skips configs inside node_modules', async () => {
    const root = makeWorkspace({ 'node_modules/x/drizzle.config.ts': 'export default {}' });
    const results = await createNodesV2[1](
      ['node_modules/x/drizzle.config.ts'],
      {},
      makeContext(root),
    );
    expect(results).toHaveLength(0);
  });

  it('produces deterministic output regardless of input order', async () => {
    const root = makeWorkspace({
      'a/drizzle.config.ts': 'export default {}',
      'b/drizzle.config.ts': 'export default {}',
    });
    const fwd = await createNodesV2[1](
      ['a/drizzle.config.ts', 'b/drizzle.config.ts'],
      {},
      makeContext(root),
    );
    const rev = await createNodesV2[1](
      ['b/drizzle.config.ts', 'a/drizzle.config.ts'],
      {},
      makeContext(root),
    );
    expect(fwd).toEqual(rev);
  });
});
