#!/usr/bin/env node

/**
 * `npm create @nx-devkit` — bootstrap a zero-config Nx monorepo in one command.
 *
 * Thin launcher: resolves the target dir and package manager, installs
 * `nx` + `@nx-devkit/typescript` there, then delegates all scaffolding to
 * the `monorepo` generator at `@nx-devkit/typescript:monorepo`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bound each install/generator run so a stalled package-manager process
// cannot pend the bootstrap command indefinitely.
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

const GENERATOR = '@nx-devkit/typescript:monorepo';
const BOOTSTRAP_DEPS = ['nx@^24.0.0', '@nx/devkit@^24.0.0', '@nx-devkit/typescript'];
const PACKAGE_NAME_PATTERN = /^(@[a-z0-9-~][a-z0-9-~._]*\/)?[a-z0-9-~][a-z0-9-~._]*$/;

export type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';
export type PackageDir = 'packages' | 'apps' | 'libs';

export interface CreateOptions {
  /** First package / workspace name (positional arg). */
  name?: string;
  /** Target directory. Default: ./<name>, or cwd when no name is given. */
  dir?: string;
  /** Package manager override. Default: detected. */
  pm?: PackageManager;
  packageDir: PackageDir;
  test: boolean;
  lint: boolean;
  format: boolean;
  build: boolean;
  nativeTest: boolean;
  skipInstall: boolean;
  help: boolean;
}

const USAGE = `Usage: npm create @nx-devkit [name|.] [options]

  name                  First package name — creates ./<name> (npm package name)
  .                     Scaffold into the current directory

Options:
  --dir <path>          Target directory explicitly
  --pm <pm>             Package manager: bun | npm | pnpm | yarn (default: detected)
  --package-dir <dir>   packages | apps | libs (default: packages)
  --native-test         Native Node test runner instead of vitest
  --no-test             Skip vitest
  --no-lint             Skip oxlint
  --no-format           Skip biome
  --no-build            Skip tsdown
  --no-install          Skip dependency install
  -h, --help            Show this help
`;

export function detectPackageManager(
  dir: string,
  env: NodeJS.ProcessEnv = process.env,
): PackageManager {
  const ua = env.npm_config_user_agent ?? '';
  if (ua.startsWith('bun/')) return 'bun';
  if (ua.startsWith('pnpm/')) return 'pnpm';
  if (ua.startsWith('yarn/')) return 'yarn';
  if (ua.startsWith('npm/')) return 'npm';
  if (existsSync(join(dir, 'bun.lock')) || existsSync(join(dir, 'bun.lockb'))) return 'bun';
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

const BOOL_FLAGS: Record<string, (o: CreateOptions) => void> = {
  '-h': (o) => {
    o.help = true;
  },
  '--help': (o) => {
    o.help = true;
  },
  '--native-test': (o) => {
    o.nativeTest = true;
  },
  '--no-test': (o) => {
    o.test = false;
  },
  '--no-lint': (o) => {
    o.lint = false;
  },
  '--no-format': (o) => {
    o.format = false;
  },
  '--no-build': (o) => {
    o.build = false;
  },
  '--no-install': (o) => {
    o.skipInstall = true;
  },
};

// Flags that consume the next argv entry. Returns the new index, or null when
// `arg` is not a value flag.
function parseValueFlag(opts: CreateOptions, argv: string[], i: number): number | null {
  const arg = argv[i];
  if (arg === '--dir') {
    const dir = argv[i + 1];
    if (!dir) throw new Error('--dir requires a path');
    opts.dir = dir;
    return i + 1;
  }
  if (arg === '--pm') {
    const pm = argv[i + 1];
    if (!['bun', 'npm', 'pnpm', 'yarn'].includes(pm ?? '')) {
      throw new Error(`--pm must be one of: bun, npm, pnpm, yarn (got "${pm}")`);
    }
    opts.pm = pm as PackageManager;
    return i + 1;
  }
  if (arg === '--package-dir') {
    const dir = argv[i + 1];
    if (!['packages', 'apps', 'libs'].includes(dir ?? '')) {
      throw new Error(`--package-dir must be one of: packages, apps, libs (got "${dir}")`);
    }
    opts.packageDir = dir as PackageDir;
    return i + 1;
  }
  return null;
}

function parsePositional(opts: CreateOptions, arg: string): void {
  if (opts.name !== undefined || opts.dir !== undefined) {
    throw new Error(`Unexpected extra argument: ${arg}`);
  }
  if (arg === '.' || arg === '..') {
    opts.dir = arg;
  } else {
    opts.name = arg;
  }
}

export function parseArgs(argv: string[]): CreateOptions {
  const opts: CreateOptions = {
    packageDir: 'packages',
    test: true,
    lint: true,
    format: true,
    build: true,
    nativeTest: false,
    skipInstall: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    const boolHandler = BOOL_FLAGS[arg];
    if (boolHandler) {
      boolHandler(opts);
      continue;
    }
    const consumed = parseValueFlag(opts, argv, i);
    if (consumed !== null) {
      i = consumed;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`Unknown flag: ${arg}`);
    parsePositional(opts, arg);
  }

  if (opts.name !== undefined && !PACKAGE_NAME_PATTERN.test(opts.name)) {
    throw new Error(
      `Invalid package name: "${opts.name}". Must be a valid npm package name (e.g., "my-pkg" or "@scope/my-pkg").`,
    );
  }

  return opts;
}

export function buildGeneratorArgs(
  opts: Pick<
    CreateOptions,
    'packageDir' | 'test' | 'lint' | 'format' | 'build' | 'nativeTest' | 'skipInstall'
  > & { pm: PackageManager },
  name: string,
): string[] {
  const args = [
    'g',
    GENERATOR,
    name,
    `--packageManager=${opts.pm}`,
    `--packageDir=${opts.packageDir}`,
    `--test=${opts.test}`,
    `--lint=${opts.lint}`,
    `--format=${opts.format}`,
    `--build=${opts.build}`,
    `--nativeTest=${opts.nativeTest}`,
    '--interactive=false',
  ];
  if (opts.skipInstall) args.push('--skipInstall');
  return args;
}

type Exec = (cmd: string, args: string[], cwd: string) => void;

const defaultExec: Exec = (cmd, args, cwd) => {
  execFileSync(cmd, args, {
    stdio: 'inherit',
    cwd,
    // Windows package managers are `.cmd` shims — they only resolve through
    // the shell, so a bare spawn there fails with ENOENT.
    shell: process.platform === 'win32',
    timeout: INSTALL_TIMEOUT_MS,
  });
};

function installDeps(pm: PackageManager, cwd: string, exec: Exec): void {
  const installArgs: Record<PackageManager, [string, string[]]> = {
    bun: ['bun', ['add', '-D', ...BOOTSTRAP_DEPS]],
    npm: ['npm', ['install', '-D', ...BOOTSTRAP_DEPS]],
    pnpm: ['pnpm', ['add', '-D', ...BOOTSTRAP_DEPS]],
    yarn: ['yarn', ['add', '-D', ...BOOTSTRAP_DEPS]],
  };
  const [cmd, args] = installArgs[pm];
  try {
    exec(cmd, args, cwd);
  } catch (error) {
    const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
    throw new Error(`Failed to install ${BOOTSTRAP_DEPS.join(', ')}${detail}`, { cause: error });
  }
}

function runGenerator(pm: PackageManager, cwd: string, args: string[], exec: Exec): void {
  const nxCmd: Record<PackageManager, [string, string[]]> = {
    bun: ['bunx', ['nx']],
    npm: ['npx', ['nx']],
    pnpm: ['pnpm', ['exec', 'nx']],
    yarn: ['yarn', ['nx']],
  };
  const [cmd, prefix] = nxCmd[pm];
  try {
    exec(cmd, [...prefix, ...args], cwd);
  } catch (error) {
    const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
    throw new Error(`Failed to run ${GENERATOR}${detail}`, { cause: error });
  }
}

function inferredTargets(opts: CreateOptions): string[] {
  const targets = ['typecheck'];
  if (opts.test) {
    if (opts.nativeTest) {
      targets.push('test');
    } else {
      targets.push('test', 'test:watch', 'test:coverage');
    }
  }
  // biome.json infers a fallback `lint` target when no .oxlintrc is written,
  // so `--no-lint --format` still yields `lint` in the scaffolded workspace.
  if (opts.lint || opts.format) targets.push('lint');
  if (opts.format) targets.push('format', 'format-check');
  if (opts.build) targets.push('build', 'build:watch');
  return targets;
}

// Compat fixups for the published monorepo generator — drop each one once the
// generator stops emitting the broken output it patches:
//  1. Generated package.json scripts (`"build": "nx build"`, …) shadow the
//     preset's inferred targets via nx:run-script and recurse into themselves.
//     `nx.includedScripts: []` keeps the scripts usable manually while letting
//     inferred targets win.
//  2. Generated tsconfig.base.json uses `baseUrl` + `paths`, but the toolchain
//     it pins (typescript 6/7) removed `baseUrl`. Strip it and make each
//     `paths` target relative to the file.
export function applyWorkspaceFixups(targetDir: string, packageDir: string, name: string): void {
  const pkgJsonPath = join(targetDir, packageDir, name, 'package.json');
  if (existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
      nx?: { includedScripts?: string[] } & Record<string, unknown>;
    };
    const scripts = pkg.scripts ?? {};
    const hasNxScripts = Object.values(scripts).some((v) => /^nx(\s|$)/.test(v));
    if (hasNxScripts && !Array.isArray(pkg.nx?.includedScripts)) {
      pkg.nx = { ...pkg.nx, includedScripts: [] };
      writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
    }
  }

  const baseConfigPath = join(targetDir, 'tsconfig.base.json');
  if (existsSync(baseConfigPath)) {
    let cfg: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
    try {
      cfg = JSON.parse(readFileSync(baseConfigPath, 'utf8'));
    } catch {
      // JSONC (comments/trailing commas) — leave the file untouched rather
      // than crash after scaffolding.
      return;
    }
    const co = cfg.compilerOptions;
    if (co && 'baseUrl' in co) {
      // tsconfig paths are POSIX-style: resolve each target against
      // `baseUrl`, then re-express it relative to this file. String concat
      // would corrupt absolute baseUrls/targets into `.//...`.
      const configDir = targetDir.split(sep).join(posix.sep);
      const baseUrl = co.baseUrl ?? '.';
      const baseAbs = posix.isAbsolute(baseUrl) ? baseUrl : posix.resolve(configDir, baseUrl);
      delete co.baseUrl;
      const paths = co.paths ?? {};
      for (const [alias, targets] of Object.entries(paths)) {
        paths[alias] = targets.map((t) => {
          const targetAbs = posix.isAbsolute(t) ? t : posix.resolve(baseAbs, t);
          const rel = posix.relative(configDir, targetAbs);
          return rel.startsWith('.') ? rel : `./${rel}`;
        });
      }
      writeFileSync(baseConfigPath, `${JSON.stringify(cfg, null, 2)}\n`);
    }
  }
}

function workspaceNameFrom(targetDir: string, opts: CreateOptions): string {
  if (opts.name) return opts.name;
  const pkgPath = join(targetDir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
    if (pkg.name && PACKAGE_NAME_PATTERN.test(pkg.name)) return pkg.name;
  }
  const dirName = basename(targetDir);
  if (PACKAGE_NAME_PATTERN.test(dirName)) return dirName;
  const sanitized = dirName
    .toLowerCase()
    .replace(/[^a-z0-9-~._]+/g, '-')
    .split('-')
    .filter(Boolean)
    .join('-');
  if (!PACKAGE_NAME_PATTERN.test(sanitized)) {
    throw new Error(
      `Cannot derive a valid npm package name from directory "${dirName}" — pass a name explicitly.`,
    );
  }
  return sanitized;
}

// The target may not exist yet — resolve symlinks in the longest existing
// prefix so a `--dir` reaching outside cwd through a symlink is still caught
// by the containment check in `run`.
function canonicalize(path: string): string {
  const missing: string[] = [];
  let existing = path;
  while (!existsSync(existing)) {
    missing.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(realpathSync(existing), ...missing);
}

export function run(
  opts: CreateOptions,
  cwd: string = process.cwd(),
  exec: Exec = defaultExec,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const realCwd = canonicalize(cwd);
  const targetDir = resolve(realCwd, opts.dir ?? opts.name ?? '.');
  const relTarget = relative(realCwd, canonicalize(targetDir));
  if (relTarget.split(/[\\/]/).includes('..') || isAbsolute(relTarget)) {
    throw new Error(
      `Target directory must be inside the current directory: ${opts.dir ?? opts.name}`,
    );
  }

  // Checked before any mutation so a rejected run leaves no partial
  // workspace behind.
  if (
    opts.skipInstall &&
    !existsSync(join(targetDir, 'node_modules', '@nx-devkit', 'typescript'))
  ) {
    throw new Error(
      '--no-install requires @nx-devkit/typescript already installed in the target directory',
    );
  }

  const pm: PackageManager = opts.pm ?? detectPackageManager(targetDir, env);
  const name = workspaceNameFrom(targetDir, opts);

  // The generator merges, it does not abort — refuse upfront when the first
  // package would land on an existing one (e.g. a package named after the
  // repo root in into-existing-repo mode).
  if (existsSync(join(targetDir, opts.packageDir, name))) {
    throw new Error(
      `Package "${name}" already exists at ${join(opts.packageDir, name)} — pass a different name or remove it first.`,
    );
  }

  mkdirSync(targetDir, { recursive: true });

  // The generator merges workspaces/nx.json into whatever is here — write
  // a stub only when missing so into-existing-repo mode never clobbers state.
  // The stub records the selected package manager; fresh workspaces
  // otherwise never persist it.
  const pkgPath = join(targetDir, 'package.json');
  if (!existsSync(pkgPath)) {
    writeFileSync(
      pkgPath,
      `${JSON.stringify({ name, version: '0.0.0', private: true, packageManager: `${pm}@latest` }, null, 2)}\n`,
    );
  }

  console.log(`Using package manager: ${pm}`);
  console.log(`Installing bootstrap deps: ${BOOTSTRAP_DEPS.join(', ')}`);
  if (!opts.skipInstall) {
    installDeps(pm, targetDir, exec);
  }

  runGenerator(pm, targetDir, buildGeneratorArgs({ ...opts, pm }, name), exec);
  applyWorkspaceFixups(targetDir, opts.packageDir, name);

  const verifyTargets = inferredTargets(opts).filter((t) =>
    ['typecheck', 'test', 'lint', 'build'].includes(t),
  );
  const shown = relTarget === '' ? '.' : relTarget;
  const cdArg = shown.includes(' ') ? `"${shown}"` : shown;
  console.log('');
  console.log(`Inferred targets: ${inferredTargets(opts).join(', ')}`);
  console.log(`Verify: cd ${cdArg} && nx run-many -t ${verifyTargets.join(',')}`);
}

export function main(argv: string[] = process.argv.slice(2)): void {
  try {
    const opts = parseArgs(argv);
    if (opts.help) {
      console.log(USAGE);
      return;
    }
    run(opts);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exit(1);
  }
}

// The PM invokes the bin through a node_modules/.bin symlink: argv[1] keeps
// the symlink path while import.meta.url resolves to the real file — compare
// canonical paths so the direct-entry check still fires.
function invokedDirectly(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main();
}
