import { parse } from 'yaml';

/**
 * A moon `deps` entry in object form. `args`/`env` pass extra context to
 * the dependency task — Nx cannot express per-dependency args, so the
 * plugin maps only `target`.
 */
export interface MoonTaskDep {
  target: string;
  optional?: boolean;
  /** Per-dep args/env — no Nx counterpart, read for completeness. */
  args?: string | string[];
  env?: Record<string, string>;
}

/**
 * A moon `inputs`/`outputs` entry — a pattern string or the object form
 * (`{ file }`, `{ glob }`, `{ group }`, `{ project }`).
 */
export type MoonPatternEntry = string | Record<string, unknown>;

/** Task options under `options:` that map onto Nx target fields. */
export interface MoonTaskOptions {
  cache?: boolean | 'local' | 'remote';
  envFile?: boolean | string | string[];
  persistent?: boolean;
}

/**
 * The subset of a moon.yml task entry the plugin maps onto an Nx target.
 * Fields moon owns that have no Nx counterpart (`checks`, `platform`,
 * `toolchains`, `options.*` tuning knobs) are ignored on purpose.
 */
export interface MoonTask {
  command?: string | string[];
  script?: string;
  args?: string | string[];
  deps?: Array<string | MoonTaskDep>;
  env?: Record<string, string>;
  inputs?: MoonPatternEntry[];
  outputs?: MoonPatternEntry[];
  options?: MoonTaskOptions;
  preset?: string;
  /** Deprecated moon field — marks the task local-only (never cached). */
  local?: boolean;
  description?: string;
  extends?: string;
}

/** A parsed moon.yml (project-level config). */
export interface MoonProjectYml {
  /** `id` overrides the project name derived from .moon/workspace.* */
  id?: string;
  /** Legacy string form of the project block also carries a name. */
  project?: string | Record<string, unknown>;
  language?: string;
  type?: string;
  stack?: string;
  tags?: string[];
  dependsOn?: Array<string | { id?: unknown; scope?: unknown }>;
  env?: Record<string, string>;
  fileGroups?: Record<string, string[]>;
  tasks: Record<string, MoonTask>;
}

/**
 * Parse a moon.yml document. Throws when the file is not a YAML map —
 * the caller decides whether the config should be skipped.
 */
export function parseMoonYml(text: string, path: string): MoonProjectYml {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    throw new Error(`Could not parse ${path}: ${String(error)}`, { cause: error });
  }
  if (!isRecord(raw)) {
    throw new Error(`Expected ${path} to be a YAML map`);
  }

  // Null-prototype record: a task key like `__proto__` must not change
  // the prototype of the map.
  const tasks: Record<string, MoonTask> = Object.create(null);
  const rawTasks = isRecord(raw.tasks) ? raw.tasks : {};
  for (const [key, value] of Object.entries(rawTasks)) {
    const task = normalizeTask(value);
    if (task !== null) tasks[key] = task;
  }

  const config: MoonProjectYml = { tasks };
  applyProjectFields(config, raw);
  return config;
}

/** Copy the optional project-level fields from the raw YAML map. */
function applyProjectFields(config: MoonProjectYml, raw: Record<string, unknown>): void {
  if (typeof raw.id === 'string' && raw.id !== '') config.id = raw.id;
  if (typeof raw.project === 'string' && raw.project !== '') {
    config.project = raw.project;
  } else if (isRecord(raw.project)) {
    config.project = raw.project;
  }
  if (typeof raw.language === 'string') config.language = raw.language;
  if (typeof raw.type === 'string') config.type = raw.type;
  if (typeof raw.stack === 'string') config.stack = raw.stack;
  const tags = stringList(raw.tags);
  if (tags.length > 0) config.tags = tags;
  const dependsOn = normalizeProjectDeps(raw.dependsOn);
  if (dependsOn.length > 0) config.dependsOn = dependsOn;
  const env = stringMap(raw.env);
  if (Object.keys(env).length > 0) config.env = env;
  const fileGroups = normalizeFileGroups(raw.fileGroups);
  if (Object.keys(fileGroups).length > 0) config.fileGroups = fileGroups;
}

/** A string task value is command shorthand; a map is the full task. */
function normalizeTask(raw: unknown): MoonTask | null {
  if (typeof raw === 'string') {
    return raw === '' ? null : { command: raw };
  }
  if (!isRecord(raw)) return null;

  const task: MoonTask = {};
  applyCommandFields(task, raw);
  applyDepFields(task, raw);
  applyMetaFields(task, raw);
  return task;
}

function applyCommandFields(task: MoonTask, raw: Record<string, unknown>): void {
  if (typeof raw.command === 'string' || isStringArray(raw.command)) {
    task.command = raw.command;
  }
  if (typeof raw.script === 'string') task.script = raw.script;
  if (typeof raw.args === 'string' || isStringArray(raw.args)) {
    task.args = raw.args;
  }
}

function applyDepFields(task: MoonTask, raw: Record<string, unknown>): void {
  const deps = normalizeTaskDeps(raw.deps);
  if (deps.length > 0) task.deps = deps;
  const env = stringMap(raw.env);
  if (Object.keys(env).length > 0) task.env = env;
  if (raw.inputs !== undefined) task.inputs = patternList(raw.inputs);
  if (raw.outputs !== undefined) task.outputs = patternList(raw.outputs);
  const options = normalizeOptions(raw.options);
  if (options !== undefined) task.options = options;
}

function applyMetaFields(task: MoonTask, raw: Record<string, unknown>): void {
  if (typeof raw.preset === 'string') task.preset = raw.preset;
  if (raw.local === true) task.local = true;
  if (typeof raw.description === 'string') task.description = raw.description;
  if (typeof raw.extends === 'string') task.extends = raw.extends;
}

function normalizeTaskDeps(raw: unknown): Array<string | MoonTaskDep> {
  if (!Array.isArray(raw)) return [];
  const out: Array<string | MoonTaskDep> = [];
  for (const entry of raw) {
    if (typeof entry === 'string' && entry !== '') {
      out.push(entry);
    } else if (isRecord(entry) && typeof entry.target === 'string' && entry.target !== '') {
      const dep: MoonTaskDep = { target: entry.target };
      if (entry.optional === true) dep.optional = true;
      out.push(dep);
    }
  }
  return out;
}

function normalizeProjectDeps(raw: unknown): Array<string | { id?: unknown; scope?: unknown }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<string | { id?: unknown; scope?: unknown }> = [];
  for (const entry of raw) {
    if (typeof entry === 'string' && entry !== '') {
      out.push(entry);
    } else if (isRecord(entry) && typeof entry.id === 'string' && entry.id !== '') {
      out.push({ id: entry.id, scope: entry.scope });
    }
  }
  return out;
}

function normalizeOptions(raw: unknown): MoonTaskOptions | undefined {
  if (!isRecord(raw)) return undefined;
  const options: MoonTaskOptions = {};
  if (typeof raw.cache === 'boolean') {
    options.cache = raw.cache;
  } else if (raw.cache === 'local' || raw.cache === 'remote') {
    options.cache = raw.cache;
  }
  if (typeof raw.envFile === 'boolean' || typeof raw.envFile === 'string') {
    options.envFile = raw.envFile;
  } else if (isStringArray(raw.envFile)) {
    options.envFile = raw.envFile;
  }
  if (typeof raw.persistent === 'boolean') options.persistent = raw.persistent;
  return Object.keys(options).length > 0 ? options : undefined;
}

function normalizeFileGroups(raw: unknown): Record<string, string[]> {
  if (!isRecord(raw)) return {};
  const out: Record<string, string[]> = Object.create(null);
  for (const [key, value] of Object.entries(raw)) {
    if (isStringArray(value)) out[key] = value;
  }
  return out;
}

function patternList(raw: unknown): MoonPatternEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is MoonPatternEntry => typeof entry === 'string' || isRecord(entry),
  );
}

function stringMap(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
  }
  return out;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
