import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit';

const PLUGIN_NAME = '@nx-devkit/prisma';

export interface NxPrismaPluginOptions {
  /** Target name prefix. Default: "db" → `db:generate`, `db:migrate`, … */
  targetPrefix?: string;
  /** Also infer `<prefix>:studio` (`prisma studio`). Default: true. */
  studio?: boolean;
}

// schema.prisma (any location) or prisma.config.* (Prisma 6+ config file).
const CONFIG_GLOB = '**/{schema.prisma,prisma.config.*}';

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isPrismaConfig(fileName: string): boolean {
  return /^prisma\.config\.[cm]?[jt]s$/.test(fileName);
}

function shouldSkipDir(projectRoot: string, workspaceRoot: string): boolean {
  const rel = relative(workspaceRoot, resolve(workspaceRoot, projectRoot || '.'));
  if (rel === '') return false;
  const segments = rel.split(/[\\/]/);
  return segments.includes('..') || segments.includes('node_modules');
}

/**
 * Owning project root for a matched file. The `prisma/schema.prisma`
 * convention puts the schema inside a `prisma/` subdirectory of the
 * project, so a file directly inside a dir named `prisma` maps to the
 * parent — unless the `prisma` dir is itself a project (own package.json
 * while the parent has none).
 */
function projectRootFor(configFile: string, workspaceRoot: string): string {
  const rawDir = dirname(configFile);
  const dir = rawDir === '.' ? '' : rawDir;
  if (basename(dir) !== 'prisma') return dir;

  const parentDir = dirname(dir);
  const parent = parentDir === '.' ? '' : parentDir;
  const dirIsProject = existsSync(join(workspaceRoot, dir, 'package.json'));
  const parentIsProject = parent === '' || existsSync(join(workspaceRoot, parent, 'package.json'));
  return dirIsProject && !parentIsProject ? dir : parent;
}

function hasPackageJsonSeed(projectRoot: string, workspaceRoot: string): boolean {
  const pkgPath = join(workspaceRoot, projectRoot, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      prisma?: { seed?: unknown };
    };
    return typeof pkg.prisma?.seed === 'string' && pkg.prisma.seed.length > 0;
  } catch {
    return false;
  }
}

/** Prisma 6+/7 keeps the seed command in prisma.config.* (`migrations.seed`). */
function hasConfigFileSeed(absPath: string): boolean {
  try {
    return /(^|[^\w])seed\s*:/.test(readFileSync(absPath, 'utf8'));
  } catch {
    return false;
  }
}

function inferPrismaTargets(
  prefix: string,
  schemaArg: string,
  inputs: string[],
  seed: boolean,
  studio: boolean,
): Record<string, TargetConfiguration> {
  const command = (args: string): { command: string; cwd: string } => ({
    command: `npx prisma ${args}${schemaArg}`,
    cwd: '{projectRoot}',
  });

  // DATABASE_URL and friends pass through process env — run-commands
  // inherits it. Connection strings MUST NOT appear in argv.
  const targets: Record<string, TargetConfiguration> = {
    [`${prefix}:generate`]: {
      executor: 'nx:run-commands',
      cache: true,
      inputs,
      outputs: [
        '{workspaceRoot}/node_modules/.prisma',
        '{workspaceRoot}/node_modules/@prisma/client',
      ],
      options: command('generate'),
    },
    [`${prefix}:migrate`]: {
      executor: 'nx:run-commands',
      cache: false,
      inputs,
      options: command('migrate dev'),
    },
    [`${prefix}:migrate-deploy`]: {
      executor: 'nx:run-commands',
      cache: false,
      inputs,
      dependsOn: [`${prefix}:generate`],
      options: command('migrate deploy'),
    },
  };

  if (studio) {
    targets[`${prefix}:studio`] = {
      executor: 'nx:run-commands',
      cache: false,
      inputs,
      options: command('studio'),
    };
  }

  if (seed) {
    targets[`${prefix}:seed`] = {
      executor: 'nx:run-commands',
      cache: false,
      inputs,
      dependsOn: [`${prefix}:generate`],
      // `db seed` takes no --schema flag — the seed command comes from
      // package.json#prisma.seed or prisma.config.*.
      options: { command: 'npx prisma db seed', cwd: '{projectRoot}' },
    };
  }

  return targets;
}

export const createNodesV2: CreateNodesV2<NxPrismaPluginOptions> = [
  CONFIG_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot;
    const prefix = options.targetPrefix ?? 'db';
    const studio = options.studio ?? true;

    // Group matched files by owning project — deterministic order.
    const byRoot = new Map<string, string[]>();
    for (const configFile of [...configFiles].map(normalize).sort()) {
      const root = projectRootFor(configFile, workspaceRoot);
      const list = byRoot.get(root) ?? [];
      list.push(configFile);
      byRoot.set(root, list);
    }

    const results: Array<readonly [string, { projects: Record<string, ProjectConfiguration> }]> =
      [];
    for (const [root, files] of [...byRoot.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (shouldSkipDir(root, workspaceRoot)) continue;

      // prisma.config.* declares the schema itself → it wins; otherwise
      // the lexically first schema.prisma carries the --schema flag.
      const configFile = files.find((f) => isPrismaConfig(basename(f)));
      const winner = configFile ?? files.at(0);
      if (winner === undefined) continue;

      const token = root ? '{projectRoot}' : '{workspaceRoot}';
      const fileInputs = files.map((f) => `${token}/${root ? f.slice(root.length + 1) : f}`);
      const inputs = [`${token}/**/*.prisma`, `${token}/package.json`, ...fileInputs];

      const schemaArg =
        configFile === undefined
          ? ` --schema ${root ? winner.slice(root.length + 1) : winner}`
          : '';

      const seed =
        hasPackageJsonSeed(root, workspaceRoot) ||
        files.some((f) => isPrismaConfig(basename(f)) && hasConfigFileSeed(join(workspaceRoot, f)));

      results.push([
        winner,
        {
          projects: {
            [root]: {
              root,
              targets: inferPrismaTargets(prefix, schemaArg, inputs, seed, studio),
            },
          },
        },
      ]);
    }

    return results;
  },
];

const plugin: { name: string; createNodesV2: typeof createNodesV2 } = {
  name: PLUGIN_NAME,
  createNodesV2,
};
export default plugin;
