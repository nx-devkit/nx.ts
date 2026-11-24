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
  const inputs = [
    '{projectRoot}/pyproject.toml',
    '{projectRoot}/**/*.py',
    '{projectRoot}/pytest.ini',
    '{projectRoot}/**/conftest.py',
    ...ctx.lockInputs,
  ];
  const target = (command: string): TargetConfiguration => ({
    executor: 'nx:run-commands',
    cache: true,
    inputs,
    options: { command, cwd: '{projectRoot}' },
  });

  const targets: Record<string, TargetConfiguration> = {};
  if (ctx.options.test !== false && ctx.tools.pytest) {
    targets['test'] = target(`${run}pytest`);
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
  if (ctx.runner === 'uv') {
    targets['lock'] = target('uv lock --check');
  } else if (ctx.runner === 'poetry') {
    targets['lock'] = target('poetry check');
  }
  return targets;
}
