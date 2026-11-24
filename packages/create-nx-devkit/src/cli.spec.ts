import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildGeneratorArgs,
  detectPackageManager,
  parseArgs,
  run,
  type PackageManager,
} from './cli.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const execMock = vi.mocked(execFileSync);

let workDir: string;

beforeEach(() => {
  execMock.mockReset();
  workDir = mkdtempSync(join(tmpdir(), 'create-nx-devkit-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('detectPackageManager', () => {
  it('detects the invoking PM from npm_config_user_agent', () => {
    expect(
      detectPackageManager(workDir, { npm_config_user_agent: 'bun/1.3.0 npm/? node/v24.0.0' }),
    ).toBe('bun');
    expect(
      detectPackageManager(workDir, {
        npm_config_user_agent: 'pnpm/9.15.0 npm/? node/v22.0.0 linux x64',
      }),
    ).toBe('pnpm');
    expect(
      detectPackageManager(workDir, {
        npm_config_user_agent: 'yarn/1.22.22 npm/? node/v22.0.0 linux x64',
      }),
    ).toBe('yarn');
    expect(
      detectPackageManager(workDir, {
        npm_config_user_agent: 'npm/10.9.0 node/v22.0.0 linux x64 workspaces/false',
      }),
    ).toBe('npm');
  });

  it('falls back to lockfiles in the target dir', () => {
    writeFileSync(join(workDir, 'bun.lock'), '');
    expect(detectPackageManager(workDir, {})).toBe('bun');
    rmSync(join(workDir, 'bun.lock'));

    writeFileSync(join(workDir, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(workDir, {})).toBe('pnpm');
    rmSync(join(workDir, 'pnpm-lock.yaml'));

    writeFileSync(join(workDir, 'yarn.lock'), '');
    expect(detectPackageManager(workDir, {})).toBe('yarn');
    rmSync(join(workDir, 'yarn.lock'));

    writeFileSync(join(workDir, 'package-lock.json'), '{}');
    expect(detectPackageManager(workDir, {})).toBe('npm');
  });

  it('defaults to npm when nothing is detected', () => {
    expect(detectPackageManager(workDir, {})).toBe('npm');
  });
});

describe('parseArgs', () => {
  it('captures the positional name', () => {
    expect(parseArgs(['my-workspace']).name).toBe('my-workspace');
  });

  it('treats "." as a target dir, not a package name', () => {
    const opts = parseArgs(['.']);
    expect(opts.name).toBeUndefined();
    expect(opts.dir).toBe('.');
  });

  it('parses --dir and --pm', () => {
    const opts = parseArgs(['--dir', './sub', '--pm', 'pnpm']);
    expect(opts.dir).toBe('./sub');
    expect(opts.pm).toBe('pnpm');
  });

  it('parses --package-dir', () => {
    expect(parseArgs(['--package-dir', 'apps']).packageDir).toBe('apps');
  });

  it('parses --no-* flags', () => {
    const opts = parseArgs(['--no-test', '--no-lint', '--no-format', '--no-build']);
    expect(opts.test).toBe(false);
    expect(opts.lint).toBe(false);
    expect(opts.format).toBe(false);
    expect(opts.build).toBe(false);
  });

  it('parses --native-test and --no-install', () => {
    const opts = parseArgs(['--native-test', '--no-install']);
    expect(opts.nativeTest).toBe(true);
    expect(opts.skipInstall).toBe(true);
  });

  it('parses --help', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--bogus'])).toThrow();
  });

  it('rejects an invalid --pm value', () => {
    expect(() => parseArgs(['--pm', 'deno'])).toThrow();
  });
});

describe('buildGeneratorArgs', () => {
  it('maps options to @nx-devkit/typescript:monorepo flags', () => {
    const args = buildGeneratorArgs(
      {
        name: 'my-ws',
        packageDir: 'apps',
        pm: 'pnpm',
        test: false,
        lint: true,
        format: false,
        build: true,
        nativeTest: false,
        skipInstall: false,
      } as never,
      'my-ws',
    );
    expect(args).toContain('my-ws');
    expect(args).toContain('--packageManager=pnpm');
    expect(args).toContain('--packageDir=apps');
    expect(args).toContain('--test=false');
    expect(args).toContain('--lint=true');
    expect(args).toContain('--format=false');
    expect(args).toContain('--build=true');
    expect(args).toContain('--nativeTest=false');
    expect(args).toContain('--interactive=false');
    expect(args).not.toContain('--skipInstall');
  });

  it('adds --skipInstall when requested', () => {
    const args = buildGeneratorArgs({ skipInstall: true } as never, 'x');
    expect(args).toContain('--skipInstall');
  });
});

describe('run', () => {
  const pms: Array<[PackageManager, [string, string[]], [string, string[]]]> = [
    ['bun', ['bun', ['add', '-D']], ['bunx', ['nx']]],
    ['npm', ['npm', ['install', '-D']], ['npx', ['nx']]],
    ['pnpm', ['pnpm', ['add', '-D']], ['pnpm', ['exec', 'nx']]],
    ['yarn', ['yarn', ['add', '-D']], ['yarn', ['nx']]],
  ];

  it.each(pms)('installs deps and runs the monorepo generator with %s', (pm, install, nx) => {
    run({ ...parseArgs(['my-ws', '--pm', pm]), pm }, workDir, execMock as never, {});

    const calls = execMock.mock.calls.map((c) => [c[0], c[1]]);
    const installCall = calls.find(
      (c) => c[0] === install[0] && (c[1] as string[])[0] === install[1][0],
    );
    expect(installCall).toBeTruthy();
    const pkgs = installCall![1] as string[];
    expect(pkgs).toEqual(
      expect.arrayContaining(['nx@^24.0.0', '@nx/devkit@^24.0.0', '@nx-devkit/typescript']),
    );

    // The generator call is the one carrying the `g` subcommand — for pnpm/yarn
    // the nx prefix shares the install command's name, so do not match on c[0].
    const nxCall = calls.find((c) => c[0] === nx[0] && (c[1] as string[]).includes('g'));
    expect(nxCall).toBeTruthy();
    const nxArgs = nxCall![1] as string[];
    expect(nxArgs.slice(0, nx[1].length)).toEqual(nx[1]);
    expect(nxArgs).toEqual(
      expect.arrayContaining([
        'g',
        '@nx-devkit/typescript:monorepo',
        'my-ws',
        '--interactive=false',
      ]),
    );
  });

  it('creates the target directory and a stub package.json when missing', () => {
    run({ ...parseArgs(['my-ws', '--pm', 'npm']), pm: 'npm' }, workDir, execMock as never, {});
    const pkgPath = join(workDir, 'my-ws', 'package.json');
    expect(existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    expect(pkg.private).toBe(true);
    expect(pkg.packageManager).toBe('npm@latest');
  });

  it('rejects a target that escapes the cwd through a symlink', () => {
    const outside = mkdtempSync(join(tmpdir(), 'create-nx-devkit-outside-'));
    try {
      symlinkSync(outside, join(workDir, 'escape'));
      expect(() =>
        run(
          { ...parseArgs(['--dir', 'escape', '--pm', 'npm']), pm: 'npm' },
          workDir,
          execMock as never,
          {},
        ),
      ).toThrow('inside the current directory');
      expect(execMock).not.toHaveBeenCalled();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects --no-install before mutating a fresh target', () => {
    expect(() =>
      run(
        { ...parseArgs(['fresh-ws', '--no-install', '--pm', 'npm']), pm: 'npm' },
        workDir,
        execMock as never,
        {},
      ),
    ).toThrow('--no-install');
    expect(existsSync(join(workDir, 'fresh-ws'))).toBe(false);
    expect(execMock).not.toHaveBeenCalled();
  });

  it('aborts when the target package already exists (existing-repo mode)', () => {
    writeFileSync(join(workDir, 'package.json'), JSON.stringify({ name: 'existing-ws' }));
    mkdirSync(join(workDir, 'packages', 'existing-ws'), { recursive: true });
    expect(() =>
      run({ ...parseArgs(['--pm', 'npm']), pm: 'npm' }, workDir, execMock as never, {}),
    ).toThrow('already exists');
    expect(execMock).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing package.json (into-existing-repo mode)', () => {
    writeFileSync(join(workDir, 'package.json'), JSON.stringify({ name: 'existing-ws' }));
    run({ ...parseArgs(['--pm', 'npm']), pm: 'npm' }, workDir, execMock as never, {});
    expect(readFileSync(join(workDir, 'package.json'), 'utf8')).toContain('existing-ws');
    const nxCall = execMock.mock.calls.find((c) => (c[1] as string[]).includes('g'));
    expect(nxCall![1]).toContain('existing-ws');
  });

  it('uses the dir basename as workspace name when no package.json name exists', () => {
    run({ ...parseArgs(['--pm', 'npm']), pm: 'npm' }, workDir, execMock as never, {});
    const nxCall = execMock.mock.calls.find((c) => (c[1] as string[]).includes('g'));
    expect(nxCall![1]).toContain(basename(workDir).toLowerCase());
  });

  it('runs compat fixups after the generator', () => {
    // Simulate the generator's output: recursive scripts + baseUrl tsconfig.
    execMock.mockImplementation(((_cmd: string, args: string[], cwd: string) => {
      if (!(args as string[]).includes('g')) return;
      mkdirSync(join(cwd, 'packages', 'my-ws'), { recursive: true });
      writeFileSync(
        join(cwd, 'packages', 'my-ws', 'package.json'),
        JSON.stringify({ name: 'my-ws', scripts: { build: 'nx build' } }),
      );
      writeFileSync(
        join(cwd, 'tsconfig.base.json'),
        JSON.stringify({
          compilerOptions: { baseUrl: '.', paths: { '@my-ws/*': ['packages/*/src'] } },
        }),
      );
    }) as never);

    run({ ...parseArgs(['my-ws', '--pm', 'npm']), pm: 'npm' }, workDir, execMock as never, {});

    const pkg = JSON.parse(
      readFileSync(join(workDir, 'my-ws', 'packages', 'my-ws', 'package.json'), 'utf8'),
    );
    expect(pkg.nx.includedScripts).toEqual([]);
    const base = JSON.parse(readFileSync(join(workDir, 'my-ws', 'tsconfig.base.json'), 'utf8'));
    expect(base.compilerOptions.baseUrl).toBeUndefined();
    expect(base.compilerOptions.paths['@my-ws/*']).toEqual(['./packages/*/src']);
  });

  it('rebases tsconfig paths when baseUrl is a subdirectory', () => {
    execMock.mockImplementation(((_cmd: string, args: string[], cwd: string) => {
      if (!(args as string[]).includes('g')) return;
      writeFileSync(
        join(cwd, 'tsconfig.base.json'),
        JSON.stringify({
          compilerOptions: { baseUrl: './src', paths: { '@app/*': ['utils/*'] } },
        }),
      );
    }) as never);

    run({ ...parseArgs(['my-ws', '--pm', 'npm']), pm: 'npm' }, workDir, execMock as never, {});

    const base = JSON.parse(readFileSync(join(workDir, 'my-ws', 'tsconfig.base.json'), 'utf8'));
    expect(base.compilerOptions.baseUrl).toBeUndefined();
    expect(base.compilerOptions.paths['@app/*']).toEqual(['./src/utils/*']);
  });

  it('still lists lint when only formatting stays enabled', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      run(
        { ...parseArgs(['my-ws', '--no-lint', '--pm', 'npm']), pm: 'npm' },
        workDir,
        execMock as never,
        {},
      );
      const line = log.mock.calls
        .map((c) => String(c[0]))
        .find((l) => l.startsWith('Inferred targets:'));
      // biome.json still infers a fallback `lint` target without .oxlintrc.
      expect(line).toContain('lint');
    } finally {
      log.mockRestore();
    }
  });

  it('prints a resolvable verify command for nested --dir targets', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      run(
        { ...parseArgs(['--dir', join('a', 'b', 'c'), '--pm', 'npm']), pm: 'npm' },
        workDir,
        execMock as never,
        {},
      );
      const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('Verify:'));
      expect(line).toContain(join('a', 'b', 'c'));
      expect(line).not.toContain('cd c');
    } finally {
      log.mockRestore();
    }
  });

  it('propagates install failures', () => {
    execMock.mockImplementation(() => {
      throw new Error('spawn failed');
    });
    expect(() =>
      run({ ...parseArgs(['my-ws', '--pm', 'npm']), pm: 'npm' }, workDir, execMock as never, {}),
    ).toThrow('Failed to install');
  });

  it('propagates generator failures', () => {
    execMock.mockImplementation(((_cmd: string, args: string[]) => {
      if ((args as string[]).includes('g')) throw new Error('nx failed');
    }) as never);
    expect(() =>
      run({ ...parseArgs(['my-ws', '--pm', 'npm']), pm: 'npm' }, workDir, execMock as never, {}),
    ).toThrow('Failed to run @nx-devkit/typescript:monorepo');
  });
});
