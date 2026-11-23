import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CreateNodesContextV2 } from 'nx/src/devkit-exports';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodesV2, __testing } from './plugin.ts';

function makeContext(workspaceRoot = '/workspace'): CreateNodesContextV2 {
  return {
    workspaceRoot,
    nxJsonConfiguration: {},
    turboConfig: undefined,
    projectGraph: { nodes: {}, dependencies: {} },
  } as unknown as CreateNodesContextV2;
}

async function infer(files: string[], options = {}, workspaceRoot?: string) {
  const [, fn] = createNodesV2;
  return fn(files, options, makeContext(workspaceRoot));
}

const tmpDirs: string[] = [];
function makeTmpWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nx-docs-'));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('@nx-devkit/docs createNodesV2', () => {
  it('triggers on .vitepress/config.* and astro.config.*', () => {
    expect(createNodesV2[0]).toBe('**/{.vitepress/config,astro.config}.{ts,js,mts,mjs,cjs,cts}');
  });

  it('vitepress config maps to the parent of .vitepress', async () => {
    const results = await infer(['docs/.vitepress/config.ts']);
    expect(results).toHaveLength(1);
    const project = results[0]![1].projects!.docs!;
    expect(project.root).toBe('docs');
    expect(project.metadata?.technologies).toEqual(['vitepress']);
  });

  it('infers docs:dev/docs:build/docs:preview for vitepress', async () => {
    const results = await infer(['docs/.vitepress/config.ts']);
    const targets = results[0]![1].projects!.docs!.targets!;

    const dev = targets['docs:dev']!;
    expect(dev.executor).toBe('nx:run-commands');
    expect(dev.continuous).toBe(true);
    expect(dev.cache).toBe(false);
    expect(dev.options).toEqual({ command: 'npx vitepress dev', cwd: '{projectRoot}' });

    const build = targets['docs:build']!;
    expect(build.cache).toBe(true);
    expect(build.options).toEqual({ command: 'npx vitepress build', cwd: '{projectRoot}' });
    expect(build.outputs).toEqual(['{projectRoot}/.vitepress/dist', '{projectRoot}/dist']);

    const preview = targets['docs:preview']!;
    expect(preview.continuous).toBe(true);
    expect(preview.cache).toBe(false);
    expect(preview.dependsOn).toEqual(['docs:build']);
    expect(preview.options).toEqual({ command: 'npx vitepress preview', cwd: '{projectRoot}' });
  });

  it('covers .vitepress/** and the config file in build inputs', async () => {
    const results = await infer(['docs/.vitepress/config.ts']);
    const inputs = results[0]![1].projects!.docs!.targets!['docs:build']!.inputs!;
    expect(inputs).toContain('{projectRoot}/**/*');
    expect(inputs).toContain('{projectRoot}/.vitepress/**/*');
    expect(inputs).toContain('{projectRoot}/.vitepress/config.ts');
    // Build outputs and tool caches must not bust the build cache.
    expect(inputs).toContain('!{projectRoot}/.vitepress/dist');
    expect(inputs).toContain('!{projectRoot}/.vitepress/cache');
    expect(inputs).toContain('!{projectRoot}/dist');
    expect(inputs).toContain('!{projectRoot}/node_modules');
  });

  it('vitepress config at the workspace root owns the root project', async () => {
    const results = await infer(['.vitepress/config.ts']);
    const project = results[0]![1].projects!['']!;
    const build = project.targets!['docs:build']!;
    expect(build.inputs).toContain('{workspaceRoot}/.vitepress/config.ts');
    expect(build.inputs).toContain('{workspaceRoot}/.vitepress/**/*');
    expect(build.inputs).toContain('!{workspaceRoot}/.vitepress/dist');
  });

  it('astro.config.* infers astro targets on its directory', async () => {
    const results = await infer(['site/astro.config.mjs']);
    const project = results[0]![1].projects!.site!;
    expect(project.metadata?.technologies).toEqual(['astro']);

    const targets = project.targets!;
    expect(targets['docs:dev']!.options).toEqual({
      command: 'npx astro dev',
      cwd: '{projectRoot}',
    });
    expect(targets['docs:dev']!.continuous).toBe(true);
    expect(targets['docs:build']!.options).toEqual({
      command: 'npx astro build',
      cwd: '{projectRoot}',
    });
    expect(targets['docs:build']!.outputs).toEqual(['{projectRoot}/dist']);
    expect(targets['docs:preview']!.options).toEqual({
      command: 'npx astro preview',
      cwd: '{projectRoot}',
    });
    expect(targets['docs:preview']!.dependsOn).toEqual(['docs:build']);
  });

  it('marks astro.config.* with a starlight integration as astro+starlight', async () => {
    const workspaceRoot = makeTmpWorkspace({
      'astro.config.ts': `import { defineConfig } from 'astro/config';\nimport starlight from '@astrojs/starlight';\nexport default defineConfig({ integrations: [starlight({ title: 'Docs' })] });\n`,
    });
    const results = await infer(['astro.config.ts'], {}, workspaceRoot);
    expect(results[0]![1].projects!['']!.metadata?.technologies).toEqual(['astro', 'starlight']);
  });

  it('does not mark a plain astro.config.* as starlight', async () => {
    const workspaceRoot = makeTmpWorkspace({
      'astro.config.mjs': `import { defineConfig } from 'astro/config';\nexport default defineConfig({});\n`,
    });
    const results = await infer(['astro.config.mjs'], {}, workspaceRoot);
    expect(results[0]![1].projects!['']!.metadata?.technologies).toEqual(['astro']);
  });

  it('treats an unreadable astro config as plain astro', async () => {
    // File listed by the glob but absent from disk — no crash, no starlight.
    const results = await infer(['site/astro.config.ts']);
    expect(results[0]![1].projects!.site!.metadata?.technologies).toEqual(['astro']);
  });

  it('prefers astro.config.* over .vitepress/config.* in the same project root', async () => {
    const results = await infer(['docs/astro.config.ts', 'docs/.vitepress/config.ts']);
    expect(results).toHaveLength(1);
    const project = results[0]![1].projects!.docs!;
    expect(project.metadata?.technologies).toEqual(['astro']);
    expect(project.targets!['docs:build']!.options).toEqual({
      command: 'npx astro build',
      cwd: '{projectRoot}',
    });
  });

  it('supports custom targetPrefix', async () => {
    const results = await infer(['docs/.vitepress/config.ts'], { targetPrefix: 'site' });
    const targets = results[0]![1].projects!.docs!.targets!;
    expect(targets).toHaveProperty('site:dev');
    expect(targets).toHaveProperty('site:build');
    expect(targets).toHaveProperty('site:preview');
    expect(targets['site:preview']!.dependsOn).toEqual(['site:build']);
    expect(targets).not.toHaveProperty('docs:dev');
  });

  it('skips node_modules configs', async () => {
    const results = await infer([
      'node_modules/pkg/.vitepress/config.ts',
      'node_modules/pkg/astro.config.ts',
    ]);
    expect(results).toHaveLength(0);
  });

  it('skips configs escaping the workspace', async () => {
    const results = await infer(['../outside/astro.config.ts']);
    expect(results).toHaveLength(0);
  });

  it('infers independent projects per owning root', async () => {
    const results = await infer(['docs/.vitepress/config.ts', 'site/astro.config.ts']);
    expect(results).toHaveLength(2);
    const roots = results.flatMap(([, r]) => Object.keys(r.projects!));
    expect(roots).toEqual(['docs', 'site']);
  });

  it('produces deterministic output regardless of configFiles order', async () => {
    const files = [
      'site/astro.config.mjs',
      'docs/.vitepress/config.ts',
      '.vitepress/config.ts',
      'docs/astro.config.ts',
    ];
    const forward = await infer(files);
    const reverse = await infer(files.toReversed());
    expect(forward).toEqual(reverse);
  });

  it('matchConfig maps config paths to tool + project root', () => {
    expect(__testing.matchConfig('docs/.vitepress/config.ts')).toEqual({
      tool: 'vitepress',
      projectRoot: 'docs',
    });
    expect(__testing.matchConfig('.vitepress/config.ts')).toEqual({
      tool: 'vitepress',
      projectRoot: '',
    });
    expect(__testing.matchConfig('site/astro.config.mjs')).toEqual({
      tool: 'astro',
      projectRoot: 'site',
    });
    expect(__testing.matchConfig('astro.config.ts')).toEqual({
      tool: 'astro',
      projectRoot: '',
    });
    expect(__testing.matchConfig('docs/config.ts')).toBeNull();
    expect(__testing.matchConfig('docs/.vitepress/theme.ts')).toBeNull();
  });
});
