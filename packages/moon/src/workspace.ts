import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/**
 * The `.moon/` files detected at the Nx workspace root. `workspaceFile`
 * marks a real moon workspace; `toolchainFile` is read for metadata only
 * — its presence says the repo manages toolchains through moon/proto.
 */
export interface MoonWorkspace {
  workspaceFile: string | undefined;
  toolchainFile: string | undefined;
  /**
   * `.moon/workspace.*` `projects:` in map form — project dir → moon
   * project id. Glob/list form carries no ids (moon falls back to the
   * directory name there), so it yields an empty map.
   */
  projectIdsByRoot: Record<string, string>;
}

const WORKSPACE_FILES = ['.moon/workspace.yml', '.moon/workspace.yaml'];
const TOOLCHAIN_FILES = ['.moon/toolchain.yml', '.moon/toolchain.yaml'];

/** Detect `.moon/workspace.{yml,yaml}` and `.moon/toolchain.{yml,yaml}`. */
export function detectMoonWorkspace(workspaceRoot: string): MoonWorkspace {
  const workspaceFile = firstExisting(workspaceRoot, WORKSPACE_FILES);
  return {
    workspaceFile,
    toolchainFile: firstExisting(workspaceRoot, TOOLCHAIN_FILES),
    projectIdsByRoot: readProjectIds(workspaceRoot, workspaceFile),
  };
}

function firstExisting(workspaceRoot: string, candidates: string[]): string | undefined {
  for (const rel of candidates) {
    if (existsSync(join(workspaceRoot, rel))) return rel;
  }
  return undefined;
}

/**
 * `projects: { id: 'path' }` → `{ 'path': 'id' }`. A project dir with no
 * matching id simply is absent; a malformed file or the glob/list form
 * reads as an empty map — this file is metadata-level for the plugin.
 */
function readProjectIds(
  workspaceRoot: string,
  workspaceFile: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (workspaceFile === undefined) return out;
  let raw: unknown;
  try {
    raw = parse(readFileSync(join(workspaceRoot, workspaceFile), 'utf8'));
  } catch {
    return out;
  }
  const projects = isRecord(raw) ? raw.projects : undefined;
  if (!isRecord(projects)) return out;
  for (const [id, value] of Object.entries(projects)) {
    const dir = projectDir(value);
    if (id === '' || dir === undefined) continue;
    const normalized = dir.replace(/^\.?\//, '').replace(/\/+$/, '');
    if (normalized !== '' && out[normalized] === undefined) out[normalized] = id;
  }
  return out;
}

/** Map-form values are a path string or `{ path|source|root: '…' }`. */
function projectDir(value: unknown): string | undefined {
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (!isRecord(value)) return undefined;
  for (const key of ['path', 'source', 'root']) {
    const dir = value[key];
    if (typeof dir === 'string' && dir !== '') return dir;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
