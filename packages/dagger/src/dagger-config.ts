import { parseJsonObject } from '@nx-devkit/internal';

/**
 * The subset of a dagger.json document the plugin reads. `name`, `sdk`,
 * and `source` are dagger's own module fields. `functions` is an optional
 * devkit extension — `dagger functions` can only list callables at run
 * time, so a module that wants per-function Nx targets declares them here
 * (array of names, or a record whose keys are the names).
 */
export interface DaggerJson {
  /** Module name — becomes the Nx project name when no package.json exists. */
  name?: string;
  /** SDK language (`typescript`, `go`, `python`, …) — picks the source default. */
  sdk?: string;
  /** Module source dir or entry file, relative to the dagger.json dir. */
  source?: string;
  /** Declared callable function names. */
  functions: string[];
}

/**
 * Parse a dagger.json document. Throws when the file is not a JSON object —
 * the caller decides whether the config should be skipped.
 */
export function parseDaggerJson(text: string, path: string): DaggerJson {
  const raw = parseJsonObject(text, path);

  const config: DaggerJson = { functions: functionNames(raw.functions) };
  if (isNonEmptyString(raw.name)) config.name = raw.name.trim();
  if (isNonEmptyString(raw.sdk)) config.sdk = raw.sdk.trim();
  if (isNonEmptyString(raw.source)) config.source = raw.source.trim();
  return config;
}

/**
 * `functions` accepts a list of names or a record keyed by name — either
 * form spells "these are the module's callable functions".
 */
function functionNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => isNonEmptyString(entry)).map((e) => e.trim());
  }
  if (typeof value === 'object' && value !== null) {
    return Object.keys(value).filter((key) => key.trim() !== '');
  }
  return [];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
