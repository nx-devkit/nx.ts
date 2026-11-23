import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CreateNodesContextV2 } from 'nx/src/project-graph/plugins/public-api';
import { describe, expect, it } from 'vitest';
import { createNodesV2 } from './plugin.ts';

function makeContext(workspaceRoot: string): CreateNodesContextV2 {
  return {
    nxJsonConfiguration: {},
    workspaceRoot,
  } as unknown as CreateNodesContextV2;
}

function makeWorkspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'nx-prisma-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

type Targets = Record<
  string,
  {
    executor: string;
    cache: boolean;
    options: { command: string; cwd: string };
    dependsOn?: string[];
  }
>;

async function infer(configFiles: string[], workspaceRoot = '/workspace', options = {}) {
  const result = await createNodesV2[1](configFiles, options, makeContext(workspaceRoot));
  return result as ReadonlyArray<
    readonly [string, { projects: Record<string, { targets: Targets }> }]
  >;
}

describe('@nx-devkit/prisma createNodesV2', () => {
  it('returns empty array when no prisma files are matched', async () => {
    expect(await infer([])).toEqual([]);
  });

  it('infers db targets for prisma/schema.prisma on the owning project', async () => {
    const result = await infer(['apps/api/prisma/schema.prisma']);
    expect(result).toHaveLength(1);

    const targets = result[0]![1].projects['apps/api']!.targets;
    expect(targets['db:generate']).toBeDefined();
    expect(targets['db:migrate']).toBeDefined();
    expect(targets['db:migrate-deploy']).toBeDefined();
    expect(targets['db:studio']).toBeDefined();
    expect(targets['db:seed']).toBeUndefined();
  });

  it('passes the schema path relative to projectRoot via --schema', async () => {
    const result = await infer(['apps/api/prisma/schema.prisma']);
    const targets = result[0]![1].projects['apps/api']!.targets;
    expect(targets['db:generate']!.options.command).toBe(
      'npx prisma generate --schema prisma/schema.prisma',
    );
    expect(targets['db:migrate']!.options.command).toBe(
      'npx prisma migrate dev --schema prisma/schema.prisma',
    );
    expect(targets['db:migrate-deploy']!.options.command).toBe(
      'npx prisma migrate deploy --schema prisma/schema.prisma',
    );
    expect(targets['db:studio']!.options.command).toBe(
      'npx prisma studio --schema prisma/schema.prisma',
    );
    expect(targets['db:generate']!.options.cwd).toBe('{projectRoot}');
  });

  it('handles a schema.prisma at the project root', async () => {
    const result = await infer(['apps/api/schema.prisma']);
    const targets = result[0]![1].projects['apps/api']!.targets;
    expect(targets['db:generate']!.options.command).toBe(
      'npx prisma generate --schema schema.prisma',
    );
  });

  it('infers targets on the workspace-root project for root prisma/schema.prisma', async () => {
    const result = await infer(['prisma/schema.prisma']);
    expect(result).toHaveLength(1);
    const targets = result[0]![1].projects['']!.targets;
    expect(targets['db:generate']!.options.command).toBe(
      'npx prisma generate --schema prisma/schema.prisma',
    );
  });

  it('detects prisma.config.ts and passes no --schema flag', async () => {
    const result = await infer(['apps/api/prisma.config.ts']);
    const targets = result[0]![1].projects['apps/api']!.targets;
    expect(targets['db:generate']!.options.command).toBe('npx prisma generate');
    expect(targets['db:migrate']!.options.command).toBe('npx prisma migrate dev');
  });

  it('dedupes schema.prisma and prisma.config.ts owned by the same project', async () => {
    const result = await infer(['apps/api/prisma/schema.prisma', 'apps/api/prisma.config.ts']);
    expect(result).toHaveLength(1);
    // prisma.config.* wins — it declares the schema location itself.
    const targets = result[0]![1].projects['apps/api']!.targets;
    expect(targets['db:generate']!.options.command).toBe('npx prisma generate');
  });

  it('caches only db:generate; mutating targets are uncached', async () => {
    const result = await infer(['apps/api/prisma/schema.prisma']);
    const targets = result[0]![1].projects['apps/api']!.targets;
    expect(targets['db:generate']!.cache).toBe(true);
    expect(targets['db:migrate']!.cache).toBe(false);
    expect(targets['db:migrate-deploy']!.cache).toBe(false);
    expect(targets['db:studio']!.cache).toBe(false);
  });

  it('db:migrate-deploy depends on db:generate', async () => {
    const result = await infer(['apps/api/prisma/schema.prisma']);
    const targets = result[0]![1].projects['apps/api']!.targets;
    expect(targets['db:migrate-deploy']!.dependsOn).toEqual(['db:generate']);
  });

  it('never puts connection strings or env values on the command line', async () => {
    const result = await infer(['apps/api/prisma/schema.prisma']);
    const targets = result[0]![1].projects['apps/api']!.targets;
    for (const target of Object.values(targets)) {
      expect(target.options.command).not.toContain('DATABASE_URL');
      expect(target.options.command).not.toContain('://');
    }
  });

  it('adds db:seed when package.json declares prisma.seed', async () => {
    const root = makeWorkspace({
      'apps/api/package.json': JSON.stringify({
        name: 'api',
        prisma: { seed: 'tsx prisma/seed.ts' },
      }),
    });
    const result = await infer(['apps/api/prisma/schema.prisma'], root);
    const targets = result[0]![1].projects['apps/api']!.targets;
    expect(targets['db:seed']!.options.command).toBe('npx prisma db seed');
    expect(targets['db:seed']!.cache).toBe(false);
    expect(targets['db:seed']!.dependsOn).toEqual(['db:generate']);
  });

  it('adds db:seed when prisma.config.* declares a seed', async () => {
    const root = makeWorkspace({
      'apps/api/prisma.config.ts':
        "export default { migrations: { seed: 'tsx prisma/seed.ts' } }\n",
      'apps/api/package.json': JSON.stringify({ name: 'api' }),
    });
    const result = await infer(['apps/api/prisma.config.ts'], root);
    const targets = result[0]![1].projects['apps/api']!.targets;
    expect(targets['db:seed']).toBeDefined();
  });

  it('omits db:seed when no seed is configured', async () => {
    const root = makeWorkspace({
      'apps/api/package.json': JSON.stringify({ name: 'api' }),
    });
    const result = await infer(['apps/api/prisma/schema.prisma'], root);
    expect(result[0]![1].projects['apps/api']!.targets['db:seed']).toBeUndefined();
  });

  it('honors a custom targetPrefix', async () => {
    const result = await infer(['apps/api/prisma/schema.prisma'], '/workspace', {
      targetPrefix: 'prisma',
    });
    const targets = result[0]![1].projects['apps/api']!.targets;
    expect(targets['prisma:generate']).toBeDefined();
    expect(targets['prisma:migrate-deploy']!.dependsOn).toEqual(['prisma:generate']);
    expect(targets['db:generate']).toBeUndefined();
  });

  it('omits db:studio when studio:false', async () => {
    const result = await infer(['apps/api/prisma/schema.prisma'], '/workspace', {
      studio: false,
    });
    const targets = result[0]![1].projects['apps/api']!.targets;
    expect(targets['db:studio']).toBeUndefined();
    expect(targets['db:generate']).toBeDefined();
  });

  it('skips prisma files inside node_modules', async () => {
    expect(await infer(['node_modules/pkg/prisma/schema.prisma'])).toEqual([]);
  });

  it('skips prisma files that escape the workspace root', async () => {
    expect(await infer(['../outside/prisma/schema.prisma'])).toEqual([]);
  });

  it('a project named prisma keeps its own schema.prisma', async () => {
    const root = makeWorkspace({
      'packages/prisma/package.json': JSON.stringify({ name: 'prisma-app' }),
    });
    const result = await infer(['packages/prisma/schema.prisma'], root);
    expect(result[0]![1].projects['packages/prisma']).toBeDefined();
  });

  it('exports the createNodesV2 tuple with the prisma glob', () => {
    expect(createNodesV2[0]).toBe('**/{schema.prisma,prisma.config.*}');
  });
});
