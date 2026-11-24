import { parse } from 'smol-toml';

/** One dependency entry — the `path`/`workspace` fields drive graph edges. */
export interface CargoDep {
  /** Dependency name as declared in the dep table key. */
  name: string;
  /** `path = "…"` — local path dependency. */
  path?: string;
  /** `workspace = true` — inherited from `[workspace.dependencies]`. */
  workspace?: boolean;
}

/** `[workspace.dependencies]` raw spec — only `path` is consumed. */
export interface WorkspaceDepSpec {
  path?: string;
}

/** The semantic slice of a Cargo.toml this plugin reads. */
export interface CargoManifest {
  /** `[package].name` — undefined for virtual workspace manifests. */
  packageName: string | undefined;
  /** Present when the manifest carries a `[workspace]` table. */
  workspace: {
    /** Declared `members` globs; undefined when the key is absent. */
    members: string[] | undefined;
    /** Declared `exclude` globs (absent key → empty list). */
    exclude: string[];
    /** `[workspace.dependencies]` — resolved `workspace = true` deps. */
    dependencies: Record<string, WorkspaceDepSpec>;
  } | null;
  /**
   * Every dep table flattened: `[dependencies]`, `[dev-dependencies]`,
   * `[build-dependencies]` and `target.*` `…-dependencies` tables.
   */
  deps: CargoDep[];
}

/**
 * Parse a Cargo.toml into its semantic slice. Throws on invalid TOML —
 * the caller decides whether a broken manifest kills the graph (it does
 * not: warn + skip).
 */
export function parseCargoToml(text: string): CargoManifest {
  const doc: unknown = parse(text);
  const root = isRecord(doc) ? doc : {};

  const pkg = record(root.package);
  const name = pkg?.name;
  const packageName = typeof name === 'string' && name !== '' ? name : undefined;

  const ws = record(root.workspace);
  const workspace =
    ws === undefined
      ? null
      : {
          members: stringArray(ws.members),
          exclude: stringArray(ws.exclude) ?? [],
          dependencies: depSpecMap(ws.dependencies),
        };

  const deps: CargoDep[] = [];
  collectDepTable(deps, root.dependencies);
  collectDepTable(deps, root['dev-dependencies']);
  collectDepTable(deps, root['build-dependencies']);
  const target = record(root.target);
  if (target !== undefined) {
    for (const cfg of Object.values(target)) {
      const cfgTable = record(cfg);
      if (cfgTable === undefined) continue;
      collectDepTable(deps, cfgTable.dependencies);
      collectDepTable(deps, cfgTable['dev-dependencies']);
      collectDepTable(deps, cfgTable['build-dependencies']);
    }
  }

  return { packageName, workspace, deps };
}

function collectDepTable(out: CargoDep[], value: unknown): void {
  const table = record(value);
  if (table === undefined) return;
  for (const [name, spec] of Object.entries(table)) {
    const dep: CargoDep = { name };
    const specTable = record(spec);
    if (specTable !== undefined) {
      const path = specTable.path;
      if (typeof path === 'string' && path !== '') dep.path = path;
      if (specTable.workspace === true) dep.workspace = true;
    }
    out.push(dep);
  }
}

function depSpecMap(value: unknown): Record<string, WorkspaceDepSpec> {
  const table = record(value);
  if (table === undefined) return {};
  const out: Record<string, WorkspaceDepSpec> = {};
  for (const [name, spec] of Object.entries(table)) {
    const specTable = record(spec);
    const path = specTable?.path;
    out[name] = typeof path === 'string' && path !== '' ? { path } : {};
  }
  return out;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
