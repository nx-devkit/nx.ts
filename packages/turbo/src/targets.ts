import type { TargetConfiguration, TargetDependencyConfig } from '@nx/devkit';
import type { TurboTask } from './turbo-config.ts';

/** A target input entry — a fileset glob or an `{ env: "VAR" }` hash input. */
export type TaskInput = string | { env: string };

/** Everything a task → target mapping needs beyond the task itself. */
export interface TaskTargetContext {
  /** Nx project name of the root package — resolves `//#task` deps. */
  rootProjectName: string | undefined;
  /** Workspace-relative path of the turbo.json that defined the task. */
  configFile: string;
  /** Folded-in global inputs (globalDependencies, globalEnv, …). */
  globalInputs: TaskInput[];
}

/**
 * Split a turbo task key on its first `#`: `build` → a plain task,
 * `docs#lint` → a package-scoped task, `//#format` → the root package's
 * task (`//` is turbo's name for the workspace root).
 */
export function splitTaskKey(key: string): {
  package: string | null;
  task: string;
} {
  const idx = key.indexOf('#');
  if (idx === -1) return { package: null, task: key };
  return { package: key.slice(0, idx), task: key.slice(idx + 1) };
}

/**
 * Map one turbo task onto an Nx target running the package.json script of
 * the same name via `nx:run-script` — the script stays the single source
 * of truth, exactly like turbo runs it.
 */
export function buildTaskTarget(
  taskName: string,
  task: TurboTask,
  ctx: TaskTargetContext,
): TargetConfiguration {
  const persistent = task.persistent === true;
  const target: TargetConfiguration = {
    executor: 'nx:run-script',
    options: { script: taskName },
    // A persistent (continuous) task is never cacheable — it keeps
    // running, so there is no terminal state to hash.
    cache: persistent ? false : task.cache !== false,
    outputs: mapGlobs(task.outputs ?? ['dist/**', 'build/**'], '{projectRoot}'),
    inputs: buildInputs(task, ctx),
  };
  const dependsOn = mapDependsOn(task.dependsOn ?? [], ctx);
  if (dependsOn.length > 0) target.dependsOn = dependsOn;
  if (persistent) target.continuous = true;
  return target;
}

/**
 * turbo `dependsOn` → Nx `TargetDependencyConfig`. The legacy
 * `projects: "self" | "dependencies"` strings are intentionally not used —
 * Nx 24 rejects them; the equivalents are `{ target }` (same project) and
 * `{ target, dependencies: true }`.
 */
function mapDependsOn(deps: string[], ctx: TaskTargetContext): TargetDependencyConfig[] {
  const out: TargetDependencyConfig[] = [];
  for (const dep of deps) {
    if (typeof dep !== 'string' || dep === '') continue;
    if (dep.startsWith('^')) {
      // ^task — the task on every dependency project.
      out.push({ target: dep.slice(1), dependencies: true });
    } else if (dep.startsWith('//#')) {
      // //#task — the task on the root package. Unresolvable when the
      // root package.json has no name.
      if (ctx.rootProjectName !== undefined) {
        out.push({ target: dep.slice(3), projects: [ctx.rootProjectName] });
      }
    } else if (dep.includes('#')) {
      // pkg#task — the task on one named package.
      const sel = splitTaskKey(dep);
      if (sel.package !== null && sel.package !== '' && sel.task !== '') {
        out.push({ target: sel.task, projects: [sel.package] });
      }
    } else {
      // task — the task on the same project (projects omitted = self).
      out.push({ target: dep });
    }
  }
  return out;
}

function buildInputs(task: TurboTask, ctx: TaskTargetContext): TaskInput[] {
  // turbo treats a missing `inputs` as the default fileset.
  const raw = task.inputs ?? ['$TURBO_DEFAULT$'];
  const inputs: TaskInput[] = [];
  for (const entry of raw) {
    if (entry === '$TURBO_DEFAULT$') {
      inputs.push('default');
    } else {
      inputs.push(...mapGlobs([entry], '{projectRoot}'));
    }
  }
  for (const file of task.dotEnv ?? []) {
    inputs.push(`{projectRoot}/${file}`);
  }
  // The config the task was read from always participates in the hash —
  // an edit redefines the target.
  inputs.push(`{workspaceRoot}/${ctx.configFile}`);
  for (const name of [...(task.env ?? []), ...(task.passThroughEnv ?? [])]) {
    inputs.push({ env: name });
  }
  inputs.push(...ctx.globalInputs);
  return dedupe(inputs);
}

/**
 * Package-relative globs → `{projectRoot}`/`{workspaceRoot}`-prefixed
 * filesets, preserving `!` negations. Entries already carrying an Nx
 * `{...}` prefix pass through untouched.
 */
export function mapGlobs(globs: string[], prefix: string): string[] {
  return globs.map((glob) => {
    const negated = glob.startsWith('!');
    const body = negated ? glob.slice(1) : glob;
    if (body.startsWith('{')) return glob;
    return `${negated ? '!' : ''}${prefix}/${body}`;
  });
}

function dedupe(inputs: TaskInput[]): TaskInput[] {
  const seen = new Set<string>();
  return inputs.filter((input) => {
    const key = typeof input === 'string' ? input : JSON.stringify(input);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
