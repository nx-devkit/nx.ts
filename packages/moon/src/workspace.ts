import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The `.moon/` files detected at the Nx workspace root. `workspaceFile`
 * marks a real moon workspace; `toolchainFile` is read for metadata only
 * — its presence says the repo manages toolchains through moon/proto.
 */
export interface MoonWorkspace {
  workspaceFile: string | undefined;
  toolchainFile: string | undefined;
}

const WORKSPACE_FILES = ['.moon/workspace.yml', '.moon/workspace.yaml'];
const TOOLCHAIN_FILES = ['.moon/toolchain.yml', '.moon/toolchain.yaml'];

/** Detect `.moon/workspace.{yml,yaml}` and `.moon/toolchain.{yml,yaml}`. */
export function detectMoonWorkspace(workspaceRoot: string): MoonWorkspace {
  return {
    workspaceFile: firstExisting(workspaceRoot, WORKSPACE_FILES),
    toolchainFile: firstExisting(workspaceRoot, TOOLCHAIN_FILES),
  };
}

function firstExisting(workspaceRoot: string, candidates: string[]): string | undefined {
  for (const rel of candidates) {
    if (existsSync(join(workspaceRoot, rel))) return rel;
  }
  return undefined;
}
