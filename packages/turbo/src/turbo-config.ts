import { parseJsonObject } from '@nx-devkit/internal';

/**
 * The subset of a turbo.json task entry the plugin maps onto an Nx target.
 * Fields turbo owns that have no Nx counterpart (`with`, `interruptible`,
 * `envMode`, `interactive`, `outputLogs`) are ignored on purpose.
 */
export interface TurboTask {
  dependsOn?: string[];
  inputs?: string[];
  outputs?: string[];
  cache?: boolean;
  env?: string[];
  passThroughEnv?: string[];
  persistent?: boolean;
  dotEnv?: string[];
}

/** A parsed turbo.json, normalized to the v2 `tasks` shape. */
export interface TurboJson {
  /** `tasks` (turbo v2), falling back to `pipeline` (turbo v1). */
  tasks: Record<string, TurboTask>;
  globalDependencies: string[];
  globalEnv: string[];
  globalPassThroughEnv: string[];
  globalDotEnv: string[];
}

/**
 * Parse a turbo.json document. Throws when the file is not a JSON object —
 * the caller decides whether the config should be skipped.
 */
export function parseTurboJson(text: string, path: string): TurboJson {
  const raw = parseJsonObject(text, path);

  // turbo v2 uses `tasks`, turbo v1 `pipeline`. `tasks` wins when a
  // migrated config carries both.
  const taskMap = isRecord(raw.tasks) ? raw.tasks : isRecord(raw.pipeline) ? raw.pipeline : {};

  // A null-prototype record: a task key like `__proto__` must not change
  // the prototype of the map.
  const tasks: Record<string, TurboTask> = Object.create(null);
  for (const [key, value] of Object.entries(taskMap)) {
    if (!isRecord(value)) continue;
    tasks[key] = normalizeTask(value);
  }

  return {
    tasks,
    globalDependencies: stringList(raw.globalDependencies),
    globalEnv: stringList(raw.globalEnv),
    globalPassThroughEnv: stringList(raw.globalPassThroughEnv),
    globalDotEnv: stringList(raw.globalDotEnv),
  };
}

function normalizeTask(raw: Record<string, unknown>): TurboTask {
  const task: TurboTask = {};
  const dependsOn = stringList(raw.dependsOn);
  if (dependsOn.length > 0) task.dependsOn = dependsOn;
  const inputs = stringList(raw.inputs);
  if (raw.inputs !== undefined) task.inputs = inputs;
  const outputs = stringList(raw.outputs);
  if (raw.outputs !== undefined) task.outputs = outputs;
  if (typeof raw.cache === 'boolean') task.cache = raw.cache;
  if (typeof raw.persistent === 'boolean') task.persistent = raw.persistent;
  const env = stringList(raw.env);
  if (env.length > 0) task.env = env;
  const passThroughEnv = stringList(raw.passThroughEnv);
  if (passThroughEnv.length > 0) task.passThroughEnv = passThroughEnv;
  const dotEnv = stringList(raw.dotEnv);
  if (dotEnv.length > 0) task.dotEnv = dotEnv;
  return task;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a field as a list of strings, dropping non-string entries. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}
