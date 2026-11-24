import type { TargetConfiguration } from '@nx/devkit';
import type { TaskfileTask } from './taskfile.ts';

/**
 * Task names the plugin is willing to interpolate into a shell command.
 * A Taskfile is untrusted input; `task <name>` runs through the shell, so
 * anything that could break quoting — spaces, `;`, `$()`, quotes — is
 * rejected (and warned about by the caller) rather than escaped.
 * Namespaces (`:`) and the usual word characters are fine. A leading
 * `-` would land on the CLI as a flag (`task --init` runs task's own
 * init), so `-` is only allowed past the first character.
 */
const SAFE_TASK_NAME = /^[\w:.%@+][\w:.%@+-]*$/;

export function isSafeTaskName(name: string): boolean {
  return SAFE_TASK_NAME.test(name);
}

/**
 * The Nx target name for a task CLI name. `task` + `lib:gen` →
 * `task:lib:gen`; an empty prefix emits the CLI name verbatim.
 */
export function targetNameFor(qualifiedName: string, targetPrefix: string): string {
  return targetPrefix === '' ? qualifiedName : `${targetPrefix}:${qualifiedName}`;
}

/** Everything a task → target mapping needs beyond the task itself. */
export interface TaskTargetContext {
  /** Value of the `targetPrefix` plugin option. */
  targetPrefix: string;
  /** Value of the `cache` plugin option. */
  cache: boolean;
  /** `{workspaceRoot}`-prefixed inputs — every Taskfile that contributed. */
  inputs: string[];
}

/**
 * Map one Taskfile task onto an Nx target that runs `task <name>` via
 * `nx:run-commands`. The task CLI stays the single source of truth — no
 * `cmds` are inlined — so single-command and multi-command tasks behave
 * identically and task handles deps, vars and `dir` itself. No
 * `dependsOn` is emitted on purpose: `task <name>` already runs the
 * task's `deps`, so an Nx edge would execute every dependency twice.
 */
export function buildTaskTarget(
  qualifiedName: string,
  task: TaskfileTask,
  ctx: TaskTargetContext,
): TargetConfiguration {
  const target: TargetConfiguration = {
    executor: 'nx:run-commands',
    // Tasks are arbitrary shell — opt-in caching only.
    cache: ctx.cache,
    // 'default' keeps the project's normal inputs so source edits still
    // bust an opt-in cache; the Taskfile paths cover contributing files
    // outside the project root (transitively included Taskfiles).
    inputs: ['default', ...ctx.inputs],
    options: { command: `task ${qualifiedName}`, cwd: '{projectRoot}' },
  };

  if (task.desc !== undefined) target.metadata = { description: task.desc };
  return target;
}
