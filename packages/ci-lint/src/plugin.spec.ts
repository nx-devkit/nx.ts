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

  it('builds actionlint and zizmor legs joined so either failure fails the target', () => {
    const command = lintCiCommand(run(workspace, WORKFLOWS));

    // Each tool is probed on PATH; missing tools echo a skip instead of failing.
    expect(command).toContain('command -v actionlint');
    expect(command).toContain('command -v zizmor');
    expect(command).toContain('actionlint');
    expect(command).toContain("zizmor --format plain '.github/workflows'");
    // A real lint failure in the first leg must still fail the whole command.
    expect(command).toContain(' && ');
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

    expect(command).toContain('zizmor --format sarif');
    expect(command).toContain("> 'zizmor.sarif'");
  });

  it('appends tool-specific extra args', () => {
    const command = lintCiCommand(
      run(workspace, WORKFLOWS, {
        actionlintArgs: '-oneline',
        zizmorArgs: '--min-severity medium',
      }),
    );

    expect(command).toContain('actionlint -oneline');
    expect(command).toContain('zizmor --format plain --min-severity medium');
  });

  it('anchors a single entry on the first sorted workflow file', () => {
    const result = run(workspace, ['.github/workflows/b.yml', '.github/workflows/a.yaml']);

    expect(result).toHaveLength(1);
    expect(result[0]![0]).toBe('.github/workflows/a.yaml');
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
