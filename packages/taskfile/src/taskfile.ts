import { parse } from 'yaml';

/**
 * The subset of a Taskfile `tasks:` entry the plugin maps onto an Nx
 * target. Fields the task CLI owns that have no Nx counterpart (`cmds`,
 * `vars`, `env`, `sources`, `generates`, `silent`, `prompt`, `label`,
 * `summary`, `preconditions`, …) are ignored on purpose — the inferred
 * target always shells out to `task <name>`. `deps:` is ignored too:
 * `task` executes the deps itself, so an Nx `dependsOn` would run every
 * dependency a second time.
 */
export interface TaskfileTask {
  /** `desc:` — becomes the target's `metadata.description`. */
  desc: string | undefined;
  /** `internal: true` tasks are not callable from the CLI — no target. */
  internal: boolean;
}

/** An `includes:` entry, normalized from the string and map forms. */
export interface TaskfileInclude {
  /** `taskfile:` — a file path or a directory holding a default Taskfile. */
  taskfile: string | undefined;
  /**
   * `dir:` — the working dir the task CLI applies when it runs the
   * included tasks. The plugin reads it only as the include location
   * when `taskfile:` is absent; `task ns:name` applies `dir` itself at
   * run time.
   */
  dir: string | undefined;
  /** `optional: true` includes are skipped silently when unresolvable. */
  optional: boolean;
  /** `internal: true` includes are not callable from the CLI — skipped. */
  internal: boolean;
  /** `flatten: true` merges the included tasks without a `ns:` prefix. */
  flatten: boolean;
}

/** A parsed Taskfile: the `tasks:` map plus the `includes:` map. */
export interface Taskfile {
  tasks: Record<string, TaskfileTask>;
  includes: Record<string, TaskfileInclude>;
}

/**
 * Parse a Taskfile document. Throws when the file is not a YAML mapping —
 * the caller decides whether the config should be skipped.
 */
export function parseTaskfile(text: string, path: string): Taskfile {
  // `merge: true` expands `<<` merge keys — without it an `internal:`
  // or `desc:` inherited through an anchor is invisible here and an
  // internal task would get a runnable target the task CLI rejects.
  const raw: unknown = parse(text, { merge: true });
  if (!isRecord(raw)) {
    throw new Error(`${path}: top level is not a mapping`);
  }

  // A null-prototype record: a task key like `__proto__` must not change
  // the prototype of the map.
  const tasks: Record<string, TaskfileTask> = Object.create(null);
  if (isRecord(raw.tasks)) {
    for (const [name, value] of Object.entries(raw.tasks)) {
      const task = normalizeTask(value);
      if (task !== null) tasks[name] = task;
    }
  }

  const includes: Record<string, TaskfileInclude> = Object.create(null);
  if (isRecord(raw.includes)) {
    for (const [ns, value] of Object.entries(raw.includes)) {
      const include = normalizeInclude(value);
      if (include !== null) includes[ns] = include;
    }
  }

  return { tasks, includes };
}

function normalizeTask(value: unknown): TaskfileTask | null {
  if (!isRecord(value)) return null;
  const desc = value.desc;
  return {
    desc: typeof desc === 'string' && desc !== '' ? desc : undefined,
    internal: value.internal === true,
  };
}

function normalizeInclude(value: unknown): TaskfileInclude | null {
  // String form: `ns: ./lib/Taskfile.yml` or `ns: ./lib` (a directory).
  if (typeof value === 'string') {
    return {
      taskfile: value,
      dir: undefined,
      optional: false,
      internal: false,
      flatten: false,
    };
  }
  if (!isRecord(value)) return null;
  const taskfile = value.taskfile;
  const dir = value.dir;
  return {
    taskfile: typeof taskfile === 'string' && taskfile !== '' ? taskfile : undefined,
    dir: typeof dir === 'string' && dir !== '' ? dir : undefined,
    optional: value.optional === true,
    internal: value.internal === true,
    flatten: value.flatten === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
