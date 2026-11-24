import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodesV2 } from './plugin.ts';

const WORKFLOWS = ['.github/workflows/ci.yml'];

type NodesResult = (readonly [
  string,
  { projects: Record<string, { root: string; targets: Record<string, unknown> }> },
])[];

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'ci-lint-plugin-'));
}

function run(
  workspace: string,
  configFiles: string[],
  options: Parameters<(typeof createNodesV2)[1]>[1] = {},
): NodesResult {
  return createNodesV2[1](configFiles, options, {
    nxJsonConfiguration: {},
    workspaceRoot: workspace,
  }) as NodesResult;
}

function lintCiCommand(result: NodesResult, targetName = 'lint-ci'): string {
  const target = result[0]![1].projects['.']!.targets[targetName] as {
    options: { command: string };
  };
  return target.options.command;
}

describe('createNodesV2', () => {
  let workspace: string;

  it('watches the root .github/workflows glob', () => {
    expect(createNodesV2[0]).toBe('.github/workflows/*.{yml,yaml}');
  });

  beforeEach(() => {
    workspace = makeWorkspace();
    mkdirSync(join(workspace, '.github/workflows'), { recursive: true });
    writeFileSync(join(workspace, '.github/workflows/ci.yml'), 'on: push\n');
  });
  afterEach(() => {
    rmSync(workspace, { force: true, recursive: true });
  });

  it('infers a cached lint-ci target on the root project', () => {
    const result = run(workspace, WORKFLOWS);

    expect(result).toHaveLength(1);
    const projects = result[0]![1].projects;
    expect(Object.keys(projects)).toEqual(['.']);
    expect(projects['.']!.root).toBe('.');

    const target = projects['.']!.targets['lint-ci'] as {
      executor: string;
      cache: boolean;
      inputs: string[];
      options: { command: string; cwd: string };
    };
    expect(target.executor).toBe('nx:run-commands');
    expect(target.cache).toBe(true);
    expect(target.inputs).toContain('{workspaceRoot}/.github/workflows/*.{yml,yaml}');
    expect(target.options.cwd).toBe('{projectRoot}');
  });

  it('runs every installed leg and fails the target when any leg fails', () => {
    const command = lintCiCommand(run(workspace, WORKFLOWS));

    // Each tool is probed on PATH; missing tools echo a skip instead of failing.
    expect(command).toContain('command -v actionlint');
    expect(command).toContain('command -v zizmor');
    expect(command).toContain('actionlint');
    expect(command).toContain("zizmor --format 'plain' '.github/workflows'");
    // Legs never short-circuit: a failing leg flips the flag, the trailing
    // exit still fails the command, and later legs (zizmor/SARIF) still run.
    expect(command).not.toContain(' && ');
    expect(command).toContain('actionlint || ci_lint_failed=1');
    expect(command).toContain("'.github/workflows' || ci_lint_failed=1");
    expect(command).toContain('exit "$ci_lint_failed"');
  });

  it('honours a custom targetName', () => {
    const result = run(workspace, WORKFLOWS, { targetName: 'ci:lint' });

    const targets = result[0]![1].projects['.']!.targets;
    expect(Object.keys(targets)).toEqual(['ci:lint']);
  });

  it('drops the actionlint leg when actionlint is disabled', () => {
    const command = lintCiCommand(run(workspace, WORKFLOWS, { actionlint: false }));

    expect(command).not.toContain('actionlint');
    expect(command).toContain('command -v zizmor');
  });

  it('hashes each enabled tool version so installing or upgrading it busts the cache', () => {
    const target = run(workspace, WORKFLOWS)[0]![1].projects['.']!.targets['lint-ci'] as {
      inputs: (string | { runtime: string })[];
    };
    const runtimes = target.inputs
      .filter((i): i is { runtime: string } => typeof i === 'object' && 'runtime' in i)
      .map((i) => i.runtime);

    expect(runtimes).toHaveLength(2);
    expect(runtimes[0]).toContain('actionlint --version');
    expect(runtimes[1]).toContain('zizmor --version');
  });

  it('drops the zizmor leg when zizmor is disabled', () => {
    const command = lintCiCommand(run(workspace, WORKFLOWS, { zizmor: false }));

    expect(command).not.toContain('zizmor');
    expect(command).toContain('command -v actionlint');
  });

  it('infers no target when both tools are disabled', () => {
    const result = run(workspace, WORKFLOWS, { actionlint: false, zizmor: false });

    expect(result).toEqual([]);
  });

  it('emits SARIF output redirected to a file when configured', () => {
    const command = lintCiCommand(
      run(workspace, WORKFLOWS, { zizmorFormat: 'sarif', zizmorOutput: 'zizmor.sarif' }),
    );

    expect(command).toContain("zizmor --format 'sarif'");
    expect(command).toContain("> 'zizmor.sarif'");
  });

  it('appends tool-specific extra args', () => {
    const command = lintCiCommand(
      run(workspace, WORKFLOWS, {
        actionlintArgs: '-oneline',
        zizmorArgs: '--min-severity medium',
      }),
    );

    expect(command).toContain("actionlint '-oneline'");
    expect(command).toContain("zizmor --format 'plain' '--min-severity' 'medium'");
  });

  it('produces identical results regardless of config-file order', () => {
    const forward = run(workspace, ['.github/workflows/b.yml', '.github/workflows/a.yaml']);
    const reverse = run(workspace, ['.github/workflows/a.yaml', '.github/workflows/b.yml']);

    expect(forward).toEqual(reverse);
    expect(forward).toHaveLength(1);
    expect(forward[0]![0]).toBe('.github/workflows/a.yaml');
  });

  it('ignores workflow files outside the root .github/workflows dir', () => {
    const result = run(workspace, ['packages/foo/.github/workflows/ci.yml']);

    expect(result).toEqual([]);
  });

  it('ignores paths escaping the workspace root', () => {
    const result = run(workspace, ['../.github/workflows/ci.yml']);

    expect(result).toEqual([]);
  });

  it('returns nothing for an empty config file list', () => {
    expect(run(workspace, [])).toEqual([]);
  });
});
