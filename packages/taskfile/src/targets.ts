import type { TargetConfiguration, TargetDependencyConfig } from '@nx/devkit';
import type { TaskfileTask } from './taskfile.ts';

/**
 * Task names the plugin is willing to interpolate into a shell command.
 * A Taskfile is untrusted input; `task <name>` runs through the shell, so
 * anything that could break quoting — spaces, `;`, `$()`, quotes — is
 * rejected (and warned about by the caller) rather than escaped.
 * Namespaces (`:`) and the usual word characters are fine.
 */
const SAFE_TASK_NAME = /^[\w:.%@+-]+$/;

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
  /**
   * Namespace the task was collected under — `''` for tasks declared in
   * the matched Taskfile, `lib:` for tasks of the `lib` include. Deps
   * resolve inside the file that declares them, so a dep `build` on task
   * `lib:release` means `lib:build`.
   */
  depPrefix: string;
  /** Value of the `cache` plugin option. */
  cache: boolean;
  /** `{workspaceRoot}`-prefixed inputs — every Taskfile that contributed. */
  inputs: string[];
  /** Qualified task names that got a target — deps resolve against it. */
  resolvable: ReadonlySet<string>;
}

/**
 * Map one Taskfile task onto an Nx target that runs `task <name>` via
 * `nx:run-commands`. The task CLI stays the single source of truth — no
 * `cmds` are inlined — so single-command and multi-command tasks behave
 * identically and task handles deps, vars and `dir` itself.
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
    inputs: ctx.inputs,
    options: { command: `task ${qualifiedName}`, cwd: '{projectRoot}' },
  };

  const dependsOn = mapDependsOn(task.deps, ctx);
  if (dependsOn.length > 0) target.dependsOn = dependsOn;
  if (task.desc !== undefined) target.metadata = { description: task.desc };
  return target;
}

/**
 * Taskfile `deps` → Nx `dependsOn` on the same project (no `projects`
 * key = self). A dep resolves inside the file declaring it, so the raw
 * dep name is prefixed with the declaring namespace. Only deps that
 * resolve to an emitted target are kept — an internal task is still run
 * by `task` itself when it executes, and a dep on a missing target would
 * make Nx reject the run before the task CLI can report the real error.
 */
function mapDependsOn(deps: string[], ctx: TaskTargetContext): TargetDependencyConfig[] {
  const out: TargetDependencyConfig[] = [];
  for (const dep of deps) {
    const qualified = `${ctx.depPrefix}${dep}`;
    if (!ctx.resolvable.has(qualified)) continue;
    out.push({ target: targetNameFor(qualified, ctx.targetPrefix) });
  }
  return out;
}
