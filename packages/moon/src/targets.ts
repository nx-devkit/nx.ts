import type { TargetConfiguration, TargetDependencyConfig } from '@nx/devkit';
import { logDebug } from '@nx-devkit/internal';
import type { MoonPatternEntry, MoonTask, MoonTaskDep } from './moon-config.ts';

const PLUGIN_SCOPE = 'nx-devkit/moon';

/** A target input entry — a fileset glob or an `{ env: "VAR" }` hash input. */
export type TaskInput = string | { env: string };

/** Everything a task → target mapping needs beyond the task itself. */
export interface TaskTargetContext {
  /** Prepended to every dep's target name (the inferred target prefix). */
  targetPrefix: string;
  /** Nx project root of the moon.yml owner ('' for the workspace root). */
  projectRoot: string;
  /** Workspace-relative path of the moon.yml — always a hash input. */
  configFile: string;
  /** Project-level `env:` — applies to every task in the file. */
  projectEnv: Record<string, string>;
  /** moon `fileGroups:` — resolves `@group(name)` / `group://name` tokens. */
  fileGroups: Record<string, string[]>;
  /** Detected `.moon/*` workspace files, already prefixed for hashing. */
  workspaceInputs: string[];
}

export type ParsedDepTarget =
  | { kind: 'self'; task: string }
  | { kind: 'deps'; task: string }
  | { kind: 'project'; project: string; task: string }
  | { kind: 'unsupported'; task: string };

/**
 * Parse a moon dep target string into its scope. moon config scopes:
 * `task` / `~:task` / `~task` → this project, `^:task` / `^task` → all
 * depended-on projects, `project:task` → one named project. Run-only and
 * tag scopes (`:task`, `*:task`, `#tag:task`, `project:#tag`) have no Nx
 * `dependsOn` equivalent and map to `unsupported`.
 */
export function parseDepTarget(dep: string | MoonTaskDep): ParsedDepTarget {
  const raw = (typeof dep === 'string' ? dep : dep.target).trim();
  if (raw === '') return { kind: 'unsupported', task: '' };

  if (raw.startsWith('^')) {
    const task = stripColonPrefix(raw.slice(1));
    return task === '' || task.includes(':')
      ? { kind: 'unsupported', task }
      : { kind: 'deps', task };
  }
  if (raw.startsWith('~')) {
    const task = stripColonPrefix(raw.slice(1));
    return task === '' || task.includes(':')
      ? { kind: 'unsupported', task }
      : { kind: 'self', task };
  }

  const idx = raw.indexOf(':');
  if (idx === -1) return { kind: 'self', task: raw };
  const scope = raw.slice(0, idx);
  const task = raw.slice(idx + 1);
  if (
    scope === '' ||
    scope === '*' ||
    scope.startsWith('#') ||
    task === '' ||
    task.startsWith('#')
  ) {
    return { kind: 'unsupported', task };
  }
  return { kind: 'project', project: scope, task };
}

function stripColonPrefix(value: string): string {
  return value.startsWith(':') ? value.slice(1) : value;
}

/** moon task names that get the `server` preset automatically. */
const SERVER_TASK_NAMES = new Set(['dev', 'start', 'serve']);

/** Max file-group expansion depth — guards against reference cycles. */
const MAX_GROUP_DEPTH = 8;

/**
 * Map one moon task onto an Nx target. The task's `command`/`script`
 * runs verbatim via `nx:run-commands` in the project dir — moon itself
 * is never invoked (not even a peer dep). A task without a command is a
 * dependency aggregator and gets `nx:noop`.
 */
export function buildTaskTarget(
  taskName: string,
  task: MoonTask,
  ctx: TaskTargetContext,
): TargetConfiguration {
  const preset = task.preset ?? (SERVER_TASK_NAMES.has(taskName) ? 'server' : undefined);
  const persistent = task.options?.persistent ?? preset === 'server';
  const cache =
    !persistent &&
    task.options?.cache !== false &&
    task.local !== true &&
    preset !== 'server' &&
    preset !== 'utility';

  const envFile = resolveEnvFile(taskName, task, ctx);
  const command = resolveCommand(task, ctx);

  const target: TargetConfiguration = {
    executor: command === null ? 'nx:noop' : 'nx:run-commands',
    cache,
    inputs: buildInputs(task, envFile.inputs, ctx),
    // Output mode never yields `{ env }` entries — narrow to strings.
    outputs: mapPatterns(task.outputs ?? [], ctx, 'output').filter(
      (input): input is string => typeof input === 'string',
    ),
  };
  if (command !== null) {
    const options: Record<string, unknown> = { command, cwd: '{projectRoot}' };
    const env = { ...ctx.projectEnv, ...task.env };
    if (Object.keys(env).length > 0) options.env = env;
    if (envFile.option !== undefined) options.envFile = envFile.option;
    target.options = options;
  }
  const dependsOn = mapDependsOn(task.deps ?? [], ctx);
  if (dependsOn.length > 0) target.dependsOn = dependsOn;
  if (persistent) target.continuous = true;
  if (task.description !== undefined) target.metadata = { description: task.description };
  return target;
}

/**
 * moon `deps` → Nx `TargetDependencyConfig`, matching the turbo plugin:
 * `task`/`~:task` → self, `^:task`/`^task` → all dependencies,
 * `project:task` → one named project. `args`/`env`/`optional` on object
 * deps have no Nx counterpart and are dropped.
 */
function mapDependsOn(
  deps: Array<string | MoonTaskDep>,
  ctx: TaskTargetContext,
): TargetDependencyConfig[] {
  const out: TargetDependencyConfig[] = [];
  for (const dep of deps) {
    const parsed = parseDepTarget(dep);
    const target = `${ctx.targetPrefix}${parsed.task}`;
    switch (parsed.kind) {
      case 'self':
        out.push({ target });
        break;
      case 'deps':
        out.push({ target, dependencies: true });
        break;
      case 'project':
        out.push({ target, projects: [parsed.project] });
        break;
      default:
        logDebug(
          PLUGIN_SCOPE,
          `Skipping dep '${logSafe(typeof dep === 'string' ? dep : dep.target)}' — scope has no Nx equivalent`,
        );
    }
  }
  const seen = new Set<string>();
  return out.filter((dep) => {
    const key = JSON.stringify(dep);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Build the runnable command string. `script` supersedes
 * `command` + `args` (moon's own rule). Array forms join with spaces.
 * `$projectRoot`/`$workspaceRoot` token variables are substituted —
 * every other moon token passes through verbatim.
 */
function resolveCommand(task: MoonTask, ctx: TaskTargetContext): string | null {
  let command: string | null = null;
  if (typeof task.script === 'string' && task.script.trim() !== '') {
    command = task.script;
  } else {
    const parts = [joinArgs(task.command), joinArgs(task.args)].filter(
      (part): part is string => part !== undefined,
    );
    if (parts.length > 0) command = parts.join(' ');
  }
  if (command === null) return null;
  const up =
    ctx.projectRoot === ''
      ? '.'
      : ctx.projectRoot
          .split('/')
          .map(() => '..')
          .join('/');
  return command.replace(/\$workspaceRoot\b/g, up).replace(/\$projectRoot\b/g, '.');
}

function joinArgs(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  const joined = (Array.isArray(value) ? value.join(' ') : value).trim();
  return joined === '' ? undefined : joined;
}

/**
 * moon `options.envFile` → the run-commands `envFile` option plus hash
 * inputs. nx:run-commands hard-fails on a missing env file while moon's
 * `envFile: true` tolerates absent candidates — so `true` only becomes
 * inputs. For a list, the first file carries the option (Nx loads one);
 * every declared file is hashed either way.
 */
function resolveEnvFile(
  taskName: string,
  task: MoonTask,
  ctx: TaskTargetContext,
): { option: string | undefined; inputs: string[] } {
  const envFile = task.options?.envFile;
  if (envFile === undefined) return { option: undefined, inputs: [] };
  if (envFile === true) {
    return {
      option: undefined,
      inputs: [
        '{workspaceRoot}/.env',
        '{workspaceRoot}/.env.local',
        '{projectRoot}/.env',
        '{projectRoot}/.env.local',
        `{projectRoot}/.env.${taskName}`,
        `{projectRoot}/.env.${taskName}.local`,
      ],
    };
  }
  const list = (Array.isArray(envFile) ? envFile : [envFile]).filter(
    (path): path is string => typeof path === 'string' && path !== '',
  );
  const inputs: string[] = [];
  let option: string | undefined;
  for (const path of list) {
    if (path.startsWith('/')) {
      inputs.push(`{workspaceRoot}${path}`);
      option ??= path.slice(1);
    } else {
      inputs.push(`{projectRoot}/${path}`);
      // run-commands resolves envFile relative to the workspace root.
      option ??= ctx.projectRoot === '' ? path : `${ctx.projectRoot}/${path}`;
    }
  }
  return { option, inputs };
}

function buildInputs(task: MoonTask, envFileInputs: string[], ctx: TaskTargetContext): TaskInput[] {
  // moon treats missing inputs as "all files within the project".
  const raw = task.inputs ?? ['**/*'];
  const inputs: TaskInput[] = [];
  for (const entry of raw) {
    inputs.push(...mapPatterns([entry], ctx, 'input'));
  }
  inputs.push(...envFileInputs);
  // The moon.yml itself always participates — an edit redefines the task.
  inputs.push(`{workspaceRoot}/${ctx.configFile}`);
  inputs.push(...ctx.workspaceInputs);
  return dedupe(inputs);
}

/**
 * Map moon pattern entries to Nx `{projectRoot}`/`{workspaceRoot}`
 * filesets and `{ env }` inputs. moon vocabulary maps almost directly:
 * a leading `/` is workspace-relative, `!` negates, `$VAR` is an env
 * input, `@group(name)`/`group://name` resolve against local fileGroups,
 * `file://`/`glob://` URIs unwrap to their path. `project://` (external
 * project files) and unknown `@token(...)` functions have no Nx input
 * form and are dropped.
 */
export function mapPatterns(
  entries: MoonPatternEntry[],
  ctx: TaskTargetContext,
  mode: 'input' | 'output',
  depth = 0,
): TaskInput[] {
  const out: TaskInput[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      out.push(...mapPatternString(entry, ctx, mode, depth));
    } else {
      for (const key of ['file', 'glob'] as const) {
        const value = entry[key];
        if (typeof value === 'string') out.push(...mapPatternString(value, ctx, mode, depth));
      }
      if (typeof entry.group === 'string') {
        out.push(...resolveGroup(entry.group, ctx, mode, depth));
      }
      // `{ project: '<id>' }` — external project files, dropped like project://
    }
  }
  return out;
}

function mapPatternString(
  raw: string,
  ctx: TaskTargetContext,
  mode: 'input' | 'output',
  depth: number,
): TaskInput[] {
  let s = raw.trim();
  if (s === '') return [];
  const negated = s.startsWith('!');
  if (negated) s = s.slice(1);

  const uriMapped = mapUriPattern(s, negated, raw, ctx, mode, depth);
  if (uriMapped !== null) return uriMapped;

  const tokenMapped = mapTokenPattern(s, negated, raw, ctx, mode, depth);
  if (tokenMapped !== null) return tokenMapped;

  // $VAR env inputs and token variables.
  if (s.startsWith('$')) {
    const name = s.slice(1);
    if (name === 'projectRoot') return [negate('{projectRoot}', negated)];
    if (name === 'workspaceRoot') return [negate('{workspaceRoot}', negated)];
    // Wildcards ($FOO_*) and other token variables have no exact env input.
    if (mode === 'output' || name === '' || /[*$@{}[\]]/.test(name)) return [];
    return [{ env: name }];
  }

  return [mapPath(s, negated)];
}

/** URI forms file://, glob://, group:// (project:// dropped). `null` = not a URI. */
function mapUriPattern(
  s: string,
  negated: boolean,
  raw: string,
  ctx: TaskTargetContext,
  mode: 'input' | 'output',
  depth: number,
): TaskInput[] | null {
  const uri = /^([a-zA-Z]+):\/\/(.*)$/.exec(s);
  if (uri?.[1] === undefined || uri[2] === undefined) return null;
  const scheme = uri[1];
  const rest = uri[2].split('?')[0] ?? '';
  if (scheme === 'group') return negateAll(resolveGroup(rest, ctx, mode, depth), negated);
  if (scheme === 'file' || scheme === 'glob') {
    return negateAll(mapPatternString(rest, ctx, mode, depth), negated);
  }
  // project:// and unknown schemes can't map onto filesets.
  logDebug(PLUGIN_SCOPE, `Skipping '${logSafe(raw)}' — unsupported URI scheme`);
  return [];
}

/** @group(name)/@dirs/@files/@globs/@envs token functions → fileGroups. `null` = not a token. */
function mapTokenPattern(
  s: string,
  negated: boolean,
  raw: string,
  ctx: TaskTargetContext,
  mode: 'input' | 'output',
  depth: number,
): TaskInput[] | null {
  const token = /^@([a-zA-Z]+)\(([^)]*)\)$/.exec(s);
  if (token?.[1] === undefined || token[2] === undefined) return null;
  if (GROUP_TOKENS.has(token[1])) {
    return negateAll(resolveGroup(token[2].trim(), ctx, mode, depth), negated);
  }
  logDebug(PLUGIN_SCOPE, `Skipping '${logSafe(raw)}' — unsupported token function`);
  return [];
}

const GROUP_TOKENS = new Set([
  'group',
  'groups',
  'dir',
  'dirs',
  'file',
  'files',
  'glob',
  'globs',
  'env',
  'envs',
]);

function resolveGroup(
  name: string,
  ctx: TaskTargetContext,
  mode: 'input' | 'output',
  depth: number,
): TaskInput[] {
  if (depth >= MAX_GROUP_DEPTH) {
    logDebug(PLUGIN_SCOPE, `Skipping fileGroup '${logSafe(name)}' — reference cycle`);
    return [];
  }
  // Own-property lookup — an inherited key like `constructor` must not
  // resolve to a function and crash the mapPatterns iteration.
  const entries = Object.hasOwn(ctx.fileGroups, name) ? ctx.fileGroups[name] : undefined;
  if (entries === undefined) {
    logDebug(PLUGIN_SCOPE, `Skipping fileGroup '${logSafe(name)}' — not defined in moon.yml`);
    return [];
  }
  return mapPatterns(entries, ctx, mode, depth + 1);
}

/**
 * A project-relative path → `{projectRoot}/…`, a leading `/` →
 * `{workspaceRoot}/…`, `!` preserved. An entry already carrying an Nx
 * `{projectRoot}`/`{workspaceRoot}` token passes through untouched —
 * a brace-expansion glob like `{src,lib}/**` is NOT a token and still
 * gets the `{projectRoot}/` prefix.
 */
function mapPath(path: string, negated: boolean): string {
  let s = path;
  let neg = negated;
  if (s.startsWith('!')) {
    neg = !neg;
    s = s.slice(1);
  }
  if (s.startsWith('{projectRoot}') || s.startsWith('{workspaceRoot}')) {
    return neg ? `!${s}` : s;
  }
  const prefixed = s.startsWith('/') ? `{workspaceRoot}${s}` : `{projectRoot}/${s}`;
  return neg ? `!${prefixed}` : prefixed;
}

function negate(value: string, negated: boolean): string {
  return negated ? `!${value}` : value;
}

function negateAll(inputs: TaskInput[], negated: boolean): TaskInput[] {
  if (!negated) return inputs;
  // Toggle rather than prefix — `!group` containing `!src` yields
  // `src`, and a `!!` fileset is not valid Nx input syntax.
  return inputs.map((input) => {
    if (typeof input !== 'string') return input;
    return input.startsWith('!') ? input.slice(1) : `!${input}`;
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

/** A config value, safe inside a single log line. */
function logSafe(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out +=
      code < 32 ||
      (code >= 127 && code < 160) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
        ? ' '
        : char;
  }
  return out.trim();
}
