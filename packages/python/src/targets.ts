import type { TargetConfiguration } from '@nx/devkit';
import { runnerPrefix, type PyRunner, type PyTools } from './pyproject.ts';
import type { NxDevkitPythonOptions } from './types.ts';

/** Everything target construction needs beyond the parsed pyproject. */
export interface PythonTargetContext {
  /** Detected tools from the pyproject.toml. */
  tools: PyTools;
  /** Resolved command runner (`uv run`, `poetry run`, or plain). */
  runner: PyRunner;
  /** Lock-file inputs for the resolved runner — empty when there is none. */
  lockInputs: string[];
  /**
   * Directories of nested Python projects relative to this projectRoot.
   * pytest collects recursively, so their tests must be excluded here —
   * each nested project runs them through its own `test` target.
   */
  nestedProjectDirs: string[];
  /** Plugin options — each flag defaults to true. */
  options: NxDevkitPythonOptions;
}

/**
 * Map the declared tools onto Nx targets. Every target is cacheable —
 * pytest, ruff, ty, pyright, and the lock check are deterministic over
 * their declared inputs and produce no file outputs.
 */
export function buildTargets(ctx: PythonTargetContext): Record<string, TargetConfiguration> {
  const run = runnerPrefix(ctx.runner);
  // Everything a tool command can read: the manifest, sources, and the
  // standalone config files pytest/ruff/ty/pyright discover on their
  // own. Omitting one lets a config-only edit replay a stale result.
  const toolInputs = [
    '{projectRoot}/pyproject.toml',
    '{projectRoot}/**/*.py',
    '{projectRoot}/pytest.ini',
    '{projectRoot}/tox.ini',
    '{projectRoot}/setup.cfg',
    '{projectRoot}/**/conftest.py',
    '{projectRoot}/**/ruff.toml',
    '{projectRoot}/**/.ruff.toml',
    '{projectRoot}/**/pyrightconfig.json',
    '{projectRoot}/**/ty.toml',
    ...ctx.lockInputs,
  ];
  // `uv lock --check` / `poetry check` read only the manifest and the
  // lock file — editing a `.py` source must not rerun them.
  const lockTargetInputs = ['{projectRoot}/pyproject.toml', ...ctx.lockInputs];
  const target = (command: string, inputs: string[] = toolInputs): TargetConfiguration => ({
    executor: 'nx:run-commands',
    cache: true,
    inputs,
    options: { command, cwd: '{projectRoot}' },
  });

  const targets: Record<string, TargetConfiguration> = {};
  if (ctx.options.test !== false && ctx.tools.pytest) {
    const ignores = ctx.nestedProjectDirs.map((dir) => `--ignore=${shellQuote(dir)}`);
    targets['test'] = target(`${run}pytest${ignores.length ? ` ${ignores.join(' ')}` : ''}`);
  }
  if (ctx.options.lint !== false && ctx.tools.ruff) {
    targets['lint'] = target(`${run}ruff check`);
    targets['fmt'] = target(`${run}ruff format --check`);
  }
  if (ctx.options.typecheck !== false) {
    if (ctx.tools.ty) {
      targets['typecheck'] = target(`${run}ty check`);
    } else if (ctx.tools.pyright) {
      targets['typecheck'] = target(`${run}pyright`);
    }
  }
  // The lock check is a manager command, not an env-run tool — no `uv run`
  // / `poetry run` prefix.
  if (ctx.options.lock === false) return targets;
  if (ctx.runner === 'uv') {
    targets['lock'] = target('uv lock --check', lockTargetInputs);
  } else if (ctx.runner === 'poetry') {
    targets['lock'] = target('poetry check', lockTargetInputs);
  }
  return targets;
}

/** Single-quote a path interpolated into a shell command. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
