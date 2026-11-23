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
import { basename, join, resolve } from 'node:path';
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
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '--dir':
        opts.dir = argv[++i];
        if (!opts.dir) throw new Error('--dir requires a path');
        break;
      case '--pm': {
        const pm = argv[++i];
        if (!['bun', 'npm', 'pnpm', 'yarn'].includes(pm ?? '')) {
          throw new Error(`--pm must be one of: bun, npm, pnpm, yarn (got "${pm}")`);
        }
        opts.pm = pm as PackageManager;
        break;
      }
      case '--package-dir': {
        const dir = argv[++i];
        if (!['packages', 'apps', 'libs'].includes(dir ?? '')) {
          throw new Error(`--package-dir must be one of: packages, apps, libs (got "${dir}")`);
        }
        opts.packageDir = dir as PackageDir;
        break;
      }
      case '--native-test':
        opts.nativeTest = true;
        break;
      case '--no-test':
        opts.test = false;
        break;
      case '--no-lint':
        opts.lint = false;
        break;
      case '--no-format':
        opts.format = false;
        break;
      case '--no-build':
        opts.build = false;
        break;
      case '--no-install':
        opts.skipInstall = true;
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown flag: ${arg}`);
        if (opts.name !== undefined || opts.dir !== undefined) {
          throw new Error(`Unexpected extra argument: ${arg}`);
        }
        if (arg === '.' || arg === '..') {
          opts.dir = arg;
        } else {
          opts.name = arg;
        }
    }
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
    shell: false,
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
  if (opts.lint) targets.push('lint');
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
    const cfg = JSON.parse(readFileSync(baseConfigPath, 'utf8')) as {
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
    };
    const co = cfg.compilerOptions;
    if (co && 'baseUrl' in co) {
      delete co.baseUrl;
      for (const [alias, targets] of Object.entries(co.paths ?? {})) {
        co.paths![alias] = targets.map((t) => (t.startsWith('.') ? t : `./${t}`));
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
  return basename(targetDir);
}

export function run(
  opts: CreateOptions,
  cwd: string = process.cwd(),
  exec: Exec = defaultExec,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const targetDir = resolve(cwd, opts.dir ?? opts.name ?? '.');
  mkdirSync(targetDir, { recursive: true });

  const pm: PackageManager = opts.pm ?? detectPackageManager(targetDir, env);
  const name = workspaceNameFrom(targetDir, opts);

  // The generator merges workspaces/nx.json into whatever is here — write
  // a stub only when missing so into-existing-repo mode never clobbers state.
  const pkgPath = join(targetDir, 'package.json');
  if (!existsSync(pkgPath)) {
    writeFileSync(
      pkgPath,
      `${JSON.stringify({ name, version: '0.0.0', private: true }, null, 2)}\n`,
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
  console.log('');
  console.log(`Inferred targets: ${inferredTargets(opts).join(', ')}`);
  console.log(
    `Verify: cd ${targetDir === cwd ? '.' : basename(targetDir)} && nx run-many -t ${verifyTargets.join(',')}`,
  );
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
