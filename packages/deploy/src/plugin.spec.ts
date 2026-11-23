import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNodesV2 } from './plugin.ts';

let tmp: string;

const ctx = {
  workspaceRoot: '',
  nxJsonConfiguration: {},
} as unknown as Parameters<(typeof createNodesV2)[1]>[2];

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'deploy-plugin-'));
  (ctx as { workspaceRoot: string }).workspaceRoot = tmp;
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

interface InferredTarget {
  executor: string;
  cache?: boolean;
  continuous?: boolean;
  dependsOn?: string[];
  options: { command: string; cwd: string };
}

type Result = ReturnType<(typeof createNodesV2)[1]>;

function callWith(files: string | string[], options: Record<string, unknown> = {}) {
  const rel = (Array.isArray(files) ? files : [files]).map((f) =>
    f.startsWith(tmp) ? f.slice(tmp.length + 1) : f,
  );
  return createNodesV2[1](rel, options, ctx);
}

function makeProject(
  name: string,
  configFile: string,
  extras: { buildScript?: boolean; projectJsonBuild?: boolean } = {},
) {
  const projectRoot = name === '' ? tmp : join(tmp, 'packages', name);
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(join(projectRoot, configFile), '# fixture\n');
  const pkg: Record<string, unknown> = { name: name === '' ? 'root-app' : name };
  if (extras.buildScript) {
    pkg.scripts = { build: 'tsdown' };
  }
  writeFileSync(join(projectRoot, 'package.json'), JSON.stringify(pkg));
  if (extras.projectJsonBuild) {
    writeFileSync(
      join(projectRoot, 'project.json'),
      JSON.stringify({ name: name === '' ? 'root-app' : name, targets: { build: {} } }),
    );
  }
}

function projectFrom(result: Result, root: string): { targets: Record<string, InferredTarget> } {
  const arr = result as Array<
    readonly [string, { projects: Record<string, { targets: Record<string, InferredTarget> }> }]
  >;
  const entry = arr.find(([, { projects }]) => projects[root]);
  expect(entry, `expected a project at root "${root}"`).toBeDefined();
  return entry![1].projects[root]!;
}

function allProjectRoots(result: Result): string[] {
  const arr = result as Array<readonly [string, { projects: Record<string, unknown> }]>;
  return arr.flatMap(([, { projects }]) => Object.keys(projects));
}

describe('@nx-devkit/deploy createNodesV2', () => {
  describe('wrangler.toml', () => {
    it('infers deploy and continuous dev targets', () => {
      makeProject('worker', 'wrangler.toml');
      const result = callWith(join(tmp, 'packages', 'worker', 'wrangler.toml'));
      const { targets } = projectFrom(result, join('packages', 'worker'));

      expect(targets.deploy).toBeDefined();
      expect(targets.deploy!.executor).toBe('nx:run-commands');
      expect(targets.deploy!.options.command).toBe('wrangler deploy');
      expect(targets.deploy!.cache).toBe(false);

      expect(targets.dev).toBeDefined();
      expect(targets.dev!.options.command).toBe('wrangler dev');
      expect(targets.dev!.continuous).toBe(true);
      expect(targets.dev!.cache).toBe(false);
    });
  });

  describe('fly.toml', () => {
    it('infers an uncached deploy target with flyctl', () => {
      makeProject('api', 'fly.toml');
      const result = callWith(join(tmp, 'packages', 'api', 'fly.toml'));
      const { targets } = projectFrom(result, join('packages', 'api'));

      expect(targets.deploy!.options.command).toBe('flyctl deploy');
      expect(targets.deploy!.cache).toBe(false);
      expect(targets.dev).toBeUndefined();
    });
  });

  describe('vercel.json', () => {
    it('infers deploy and continuous dev targets', () => {
      makeProject('web', 'vercel.json');
      const result = callWith(join(tmp, 'packages', 'web', 'vercel.json'));
      const { targets } = projectFrom(result, join('packages', 'web'));

      expect(targets.deploy!.options.command).toBe('vercel deploy --prod');
      expect(targets.deploy!.cache).toBe(false);
      expect(targets.dev!.options.command).toBe('vercel dev');
      expect(targets.dev!.continuous).toBe(true);
    });
  });

  describe('netlify.toml', () => {
    it('infers an uncached deploy target', () => {
      makeProject('site', 'netlify.toml');
      const result = callWith(join(tmp, 'packages', 'site', 'netlify.toml'));
      const { targets } = projectFrom(result, join('packages', 'site'));

      expect(targets.deploy!.options.command).toBe('netlify deploy --prod');
      expect(targets.deploy!.cache).toBe(false);
      expect(targets.dev).toBeUndefined();
    });
  });

  describe('deploy target shape', () => {
    it('never caches and never interpolates secrets into argv', () => {
      for (const [name, cfg] of [
        ['w1', 'wrangler.toml'],
        ['f1', 'fly.toml'],
        ['v1', 'vercel.json'],
        ['n1', 'netlify.toml'],
      ] as const) {
        makeProject(name, cfg);
      }
      const result = callWith([
        join(tmp, 'packages', 'w1', 'wrangler.toml'),
        join(tmp, 'packages', 'f1', 'fly.toml'),
        join(tmp, 'packages', 'v1', 'vercel.json'),
        join(tmp, 'packages', 'n1', 'netlify.toml'),
      ]);
      const arr = result as Array<
        readonly [string, { projects: Record<string, { targets: Record<string, InferredTarget> }> }]
      >;
      for (const [, { projects }] of arr) {
        for (const project of Object.values(projects)) {
          const deploy = project.targets.deploy!;
          expect(deploy.executor).toBe('nx:run-commands');
          expect(deploy.cache).toBe(false);
          // Credentials travel via env vars — never on the command line.
          expect(deploy.options.command).not.toMatch(/token|secret|password|key/i);
        }
      }
    });

    it('depends on the build target when the project declares a build script', () => {
      makeProject('withbuild', 'vercel.json', { buildScript: true });
      const result = callWith(join(tmp, 'packages', 'withbuild', 'vercel.json'));
      const { targets } = projectFrom(result, join('packages', 'withbuild'));
      expect(targets.deploy!.dependsOn).toEqual(['build']);
    });

    it('depends on the build target when project.json declares one', () => {
      makeProject('projjson', 'fly.toml', { projectJsonBuild: true });
      const result = callWith(join(tmp, 'packages', 'projjson', 'fly.toml'));
      const { targets } = projectFrom(result, join('packages', 'projjson'));
      expect(targets.deploy!.dependsOn).toEqual(['build']);
    });

    it('omits dependsOn when no build exists', () => {
      makeProject('nobuild', 'netlify.toml');
      const result = callWith(join(tmp, 'packages', 'nobuild', 'netlify.toml'));
      const { targets } = projectFrom(result, join('packages', 'nobuild'));
      expect(targets.deploy!.dependsOn).toBeUndefined();
    });

    it('runs commands with cwd {projectRoot}', () => {
      makeProject('cwdp', 'wrangler.toml');
      const result = callWith(join(tmp, 'packages', 'cwdp', 'wrangler.toml'));
      const { targets } = projectFrom(result, join('packages', 'cwdp'));
      expect(targets.deploy!.options.cwd).toBe('{projectRoot}');
      expect(targets.dev!.options.cwd).toBe('{projectRoot}');
    });
  });

  describe('directory handling', () => {
    it('infers targets on the workspace-root project', () => {
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'root-app' }));
      writeFileSync(join(tmp, 'netlify.toml'), '# fixture\n');
      const result = callWith(join(tmp, 'netlify.toml'));
      const roots = allProjectRoots(result);
      expect(roots).toContain('');
      const { targets } = projectFrom(result, '');
      expect(targets.deploy!.options.command).toBe('netlify deploy --prod');
    });

    it('skips configs inside node_modules', () => {
      const dir = join(tmp, 'node_modules', 'pkg');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'vercel.json'), '{}');
      const result = callWith(join(tmp, 'node_modules', 'pkg', 'vercel.json'));
      expect(result).toEqual([]);
    });

    it('skips configs that escape the workspace root', () => {
      const outside = mkdtempSync(join(tmpdir(), 'deploy-outside-'));
      try {
        writeFileSync(join(outside, 'fly.toml'), '');
        const rel = `../${basename(outside)}/fly.toml`;
        const result = createNodesV2[1]([rel], {}, ctx);
        expect(result).toEqual([]);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it('one project per provider config — several dirs yield several projects', () => {
      const result = callWith([
        join(tmp, 'packages', 'worker', 'wrangler.toml'),
        join(tmp, 'packages', 'api', 'fly.toml'),
        join(tmp, 'packages', 'web', 'vercel.json'),
        join(tmp, 'packages', 'site', 'netlify.toml'),
      ]);
      const roots = allProjectRoots(result);
      expect(roots).toContain(join('packages', 'worker'));
      expect(roots).toContain(join('packages', 'api'));
      expect(roots).toContain(join('packages', 'web'));
      expect(roots).toContain(join('packages', 'site'));
    });

    it('deterministic precedence when several provider configs share a directory', () => {
      const dir = join(tmp, 'packages', 'multi');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'wrangler.toml'), '');
      writeFileSync(join(dir, 'vercel.json'), '{}');
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'multi' }));

      const result = callWith([
        join(tmp, 'packages', 'multi', 'vercel.json'),
        join(tmp, 'packages', 'multi', 'wrangler.toml'),
      ]);
      const arr = result as Array<readonly [string, { projects: Record<string, unknown> }]>;
      expect(arr).toHaveLength(1);
      // `wrangler.toml` ranks before `vercel.json` — its deploy target wins the dir.
      expect(arr[0]![0]).toBe(join('packages', 'multi', 'wrangler.toml'));
      const { targets } = projectFrom(result, join('packages', 'multi'));
      expect(targets.deploy!.options.command).toBe('wrangler deploy');
      expect(targets.dev!.options.command).toBe('wrangler dev');
    });

    it('ignores files that are not provider configs', () => {
      const result = callWith(join(tmp, 'packages', 'worker', 'README.md'));
      expect(result).toEqual([]);
    });
  });

  describe('options', () => {
    it('honours custom deployTargetName and devTargetName', () => {
      const result = callWith(join(tmp, 'packages', 'worker', 'wrangler.toml'), {
        deployTargetName: 'ship',
        devTargetName: 'serve',
      });
      const { targets } = projectFrom(result, join('packages', 'worker'));
      expect(targets.ship!.options.command).toBe('wrangler deploy');
      expect(targets.serve!.options.command).toBe('wrangler dev');
      expect(targets.deploy).toBeUndefined();
      expect(targets.dev).toBeUndefined();
    });
  });
});
