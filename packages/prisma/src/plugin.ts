import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit';
import { logger } from '@nx/devkit';

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

/** Dependency lockfiles that pin the installed prisma version. */
const LOCKFILES = ['bun.lock', 'bun.lockb', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];

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

/**
 * `nx:run-commands` goes through a shell — quote the schema path so a
 * directory containing spaces does not split the argument and path
 * metacharacters cannot inject shell syntax. POSIX shells single-quote;
 * cmd.exe has no single-quote and still expands `%VAR%` inside double
 * quotes, so on Windows a path containing `"`, `%`, `!`, or control
 * characters cannot be quoted safely and returns null — the caller warns
 * and skips it. Same policy as @nx-devkit/dagger's shellQuote.
 */
function shellQuote(value: string): string | null {
  if (process.platform === 'win32') {
    const hasControlChar = [...value].some((ch) => {
      const code = ch.charCodeAt(0);
      return code < 0x20 || (code >= 0x7f && code <= 0x9f);
    });
    return hasControlChar || /["%!]/.test(value) ? null : `"${value}"`;
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * `generator client { output = "…" }` dirs parsed from the group's
 * `.prisma` files, resolved to `{workspaceRoot}` output tokens. The
 * generated client lands wherever the schema points — a cached
 * db:generate must restore it. `deterministic` is false when an output
 * cannot be known statically (`output = env("…")`) or lands outside the
 * workspace; the caller then disables caching for the project.
 */
function generatorOutputs(
  workspaceRoot: string,
  files: readonly string[],
): { outputs: string[]; deterministic: boolean } {
  const outputs = new Set<string>();
  let deterministic = true;
  for (const file of files) {
    if (!file.endsWith('.prisma')) continue;
    let text: string;
    try {
      text = readFileSync(join(workspaceRoot, file), 'utf8');
    } catch {
      continue;
    }
    for (const block of text.matchAll(/generator\s+\w+\s*\{([^}]*)\}/g)) {
      const body = block[1];
      if (body === undefined) continue;
      const literal = /(?:^|[^\w])output\s*=\s*"([^"]+)"/.exec(body);
      if (literal?.[1] !== undefined) {
        const abs = resolve(workspaceRoot, dirname(file), literal[1]);
        const rel = normalize(relative(workspaceRoot, abs));
        if (rel === '' || rel.split('/').includes('..')) {
          // Outside the workspace — Nx cannot restore it from cache.
          deterministic = false;
        } else {
          outputs.add(`{workspaceRoot}/${rel}`);
        }
      } else if (/(?:^|[^\w])output\s*=/.test(body)) {
        deterministic = false;
      }
    }
  }
  return { outputs: [...outputs].sort(), deterministic };
}

function inferPrismaTargets(
  prefix: string,
  schemaArg: string,
  inputs: string[],
  generate: { cache: boolean; outputs: string[] },
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
      cache: generate.cache,
      inputs,
      outputs: [
        '{workspaceRoot}/node_modules/.prisma',
        '{workspaceRoot}/node_modules/@prisma/client',
        ...generate.outputs,
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

interface PrismaRootEntry {
  winner: string;
  schemaArg: string;
  inputs: string[];
  generate: { cache: boolean; outputs: string[] };
  seed: boolean;
}

function prismaRootEntry(
  root: string,
  files: string[],
  workspaceRoot: string,
): PrismaRootEntry | null {
  // prisma.config.* declares the schema itself → it wins; otherwise
  // the lexically first schema.prisma carries the --schema flag. An
  // unsupported prisma.config.* match (e.g. a .bak backup) is never a
  // schema — a group with neither yields no targets.
  const configFile = files.find((f) => isPrismaConfig(basename(f)));
  const winner = configFile ?? files.find((f) => basename(f) === 'schema.prisma');
  if (winner === undefined) return null;

  const token = root ? '{projectRoot}' : '{workspaceRoot}';
  const fileInputs = files.map((f) => `${token}/${root ? f.slice(root.length + 1) : f}`);
  const inputs = [
    `${token}/**/*.prisma`,
    `${token}/package.json`,
    // Generated output depends on the installed prisma version —
    // lockfiles are inputs of the cached db:generate. Check both the
    // workspace root and the project (standalone lockfile).
    ...LOCKFILES.map((f) => `{workspaceRoot}/${f}`),
    ...(root ? LOCKFILES.map((f) => `{projectRoot}/${f}`) : []),
    ...fileInputs,
  ];

  let schemaArg = '';
  if (configFile === undefined) {
    const quoted = shellQuote(root ? winner.slice(root.length + 1) : winner);
    if (quoted === null) {
      logger.warn(
        `[prisma] schema path ${JSON.stringify(
          winner,
        )} cannot be quoted safely on this platform — db targets for ${
          root || 'the workspace root'
        } are skipped`,
      );
      return null;
    }
    schemaArg = ` --schema ${quoted}`;
  }

  // Custom generator client output dirs must be restored from cache.
  // A prisma.config.* can import arbitrary files — its dependency
  // closure is not represented in inputs — so only schema.prisma
  // projects with statically resolvable outputs are cached.
  const generated = generatorOutputs(workspaceRoot, files);
  const generate = {
    cache: configFile === undefined && generated.deterministic,
    outputs: generated.outputs,
  };

  const seed =
    hasPackageJsonSeed(root, workspaceRoot) ||
    files.some((f) => isPrismaConfig(basename(f)) && hasConfigFileSeed(join(workspaceRoot, f)));

  return { winner, schemaArg, inputs, generate, seed };
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

      const entry = prismaRootEntry(root, files, workspaceRoot);
      if (entry === null) continue;

      results.push([
        entry.winner,
        {
          projects: {
            [root]: {
              root,
              targets: inferPrismaTargets(
                prefix,
                entry.schemaArg,
                entry.inputs,
                entry.generate,
                entry.seed,
                studio,
              ),
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
