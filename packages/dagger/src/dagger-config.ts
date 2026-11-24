import { logger } from '@nx/devkit';
import { parseJsonObject } from '@nx-devkit/internal';
import { logSafe } from './log-safe.ts';

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
  /** SDK language or runtime ref (`typescript`, `go`, `python`, a module ref, …) — picks the source default. */
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

  const config: DaggerJson = { functions: functionNames(raw.functions, path) };
  if (isNonEmptyString(raw.name)) config.name = raw.name.trim();
  const sdk = sdkSource(raw.sdk) ?? sdkSource(raw.runtime);
  if (sdk !== undefined) config.sdk = sdk;
  if (isNonEmptyString(raw.source)) config.source = raw.source.trim();
  // Dagger's own normalization (core/modules/config.go): a module that
  // declares an sdk but no source reads sources from the module root.
  if (config.sdk !== undefined && config.source === undefined) config.source = '.';
  return config;
}

/**
 * `sdk` is a plain ref in legacy manifests (`"sdk": "go"`) and an object
 * in modern ones (`"sdk": {"source": "go", "pin": "…"}`); `runtime` is
 * accepted as an alias, mirroring Dagger's own config unmarshal.
 */
function sdkSource(value: unknown): string | undefined {
  if (isNonEmptyString(value)) return value.trim();
  if (typeof value === 'object' && value !== null) {
    const source = (value as Record<string, unknown>).source;
    if (isNonEmptyString(source)) return source.trim();
  }
  return undefined;
}

/**
 * `functions` accepts a list of names or a record keyed by name — either
 * form spells "these are the module's callable functions". Entries that
 * are not usable names are dropped loudly, never silently.
 */
function functionNames(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    const names: string[] = [];
    let dropped = 0;
    for (const entry of value) {
      if (isNonEmptyString(entry)) names.push(entry.trim());
      else dropped++;
    }
    if (dropped > 0) {
      logger.warn(
        `[dagger] ${logSafe(path)} — "functions" ignores ${dropped} non-string entr${dropped === 1 ? 'y' : 'ies'}`,
      );
    }
    return names;
  }
  if (typeof value === 'object' && value !== null) {
    return Object.keys(value)
      .map((key) => key.trim())
      .filter((key) => key !== '');
  }
  logger.warn(
    `[dagger] ${logSafe(path)} — "functions" must be a list or record of names; ignoring it`,
  );
  return [];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
