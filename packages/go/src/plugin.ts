import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { logger, type CreateNodesResultArray, type CreateNodesV2 } from '@nx/devkit';
import { logDebug } from '@nx-devkit/internal';
import { parseGoWork } from './gowork.ts';
import { buildModuleTargets } from './targets.ts';
import type { NxDevkitGoOptions } from './types.ts';

const PLUGIN_SCOPE = 'nx-devkit/go';

/** Config files the plugin reacts to — go.work workspaces and go.mod modules. */
export const GO_GLOB = '**/{go.work,go.mod}';

/**
 * Infer Nx targets from go.work and go.mod.
 *
 * Every `use` dir of a go.work that contains a go.mod becomes a module
 * project whose targets are attributed to the go.work file — editing the
 * work file re-infers all members, and members hash `go.work`/
 * `go.work.sum` as inputs. The go.work's own directory is skipped unless
 * it also has a go.mod (then it is a module like any other — a `use .`
 * member or, when unlisted, a standalone one). A go.mod whose directory is
 * not claimed by any go.work becomes a standalone project.
 *
 * Each module gets `build`/`test`/`vet` (`go <sub> ./...`, cached) plus
 * `lint` (`golangci-lint run ./...`) when a `.golangci.{yml,yaml,json}`
 * exists in the module dir or the workspace root — gated by the
 * `lint` option (default true). Commands run with `cwd: '{projectRoot}'`;
 * `go` resolves go.work/go.mod itself, so nothing is ever passed on argv.
 */
export const createNodesV2: CreateNodesV2<NxDevkitGoOptions> = [
  GO_GLOB,
  (configFiles, options = {}, context): CreateNodesResultArray => {
    const workspaceRoot = context.workspaceRoot;
    const lint = options.lint !== false;

    const goModByDir = new Map<string, string>(); // module dir -> go.mod file
    const goWorkFiles: string[] = [];
    for (const raw of configFiles) {
      // Nx's glob expander can emit a leading "./" — normalize so paths
      // stay canonical in result keys.
      const file = normalizePath(raw);
      const dir = dirnameOf(file);
      if (isSkippedDir(dir)) {
        logDebug(PLUGIN_SCOPE, `Skipping ${logSafe(file)} — not inside the workspace`);
        continue;
      }
      if (file === 'go.work' || file.endsWith('/go.work')) {
        goWorkFiles.push(file);
      } else {
        goModByDir.set(dir, file);
      }
    }

    // Every go.work claims its use dirs. Sorted order makes the claim
    // deterministic — the first go.work wins a contested dir.
    const claimByDir = new Map<string, string>(); // module dir -> go.work file
    const membersByWork = new Map<string, string[]>();
    for (const workFile of sortPathsByDepth(goWorkFiles)) {
      const workDir = dirnameOf(workFile);
      for (const usePath of readGoWork(join(workspaceRoot, workFile), workFile)) {
        const useDir = resolveUseDir(workspaceRoot, workDir, usePath);
        if (useDir === null) {
          logDebug(PLUGIN_SCOPE, `Skipping use '${logSafe(usePath)}' in ${logSafe(workFile)}`);
          continue;
        }
        if (!goModByDir.has(useDir) && !existsSync(join(workspaceRoot, useDir, 'go.mod'))) {
          logDebug(PLUGIN_SCOPE, `Skipping ${logSafe(useDir)} — no go.mod`);
          continue;
        }
        if (claimByDir.has(useDir)) {
          logDebug(
            PLUGIN_SCOPE,
            `${logSafe(useDir)} already claimed by ${logSafe(claimByDir.get(useDir)!)}`,
          );
          continue;
        }
        claimByDir.set(useDir, workFile);
        const members = membersByWork.get(workFile) ?? [];
        members.push(useDir);
        membersByWork.set(workFile, members);
      }
    }

    return emitResults({ membersByWork, goModByDir, claimByDir, workspaceRoot, lint });
  },
];

interface EmitArgs {
  membersByWork: Map<string, string[]>;
  goModByDir: Map<string, string>;
  claimByDir: Map<string, string>;
  workspaceRoot: string;
  lint: boolean;
}

/** Members keyed to their go.work (so work edits re-infer them), then
 * unclaimed go.mod dirs as standalone modules — both sorted for
 * deterministic output. */
function emitResults(args: EmitArgs): CreateNodesResultArray {
  const { membersByWork, goModByDir, claimByDir, workspaceRoot, lint } = args;
  const results: CreateNodesResultArray = [];
  for (const workFile of [...membersByWork.keys()].sort()) {
    const projects: Record<
      string,
      { root: string; targets: ReturnType<typeof buildModuleTargets> }
    > = Object.create(null);
    for (const dir of membersByWork.get(workFile)!) {
      projects[dir] = {
        root: dir,
        targets: buildModuleTargets(dir, { workspaceRoot, goWorkFile: workFile, lint }),
      };
    }
    results.push([workFile, { projects }]);
  }
  for (const [dir, goModFile] of [...goModByDir.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (claimByDir.has(dir)) continue;
    results.push([
      goModFile,
      {
        projects: {
          [dir]: {
            root: dir,
            targets: buildModuleTargets(dir, { workspaceRoot, goWorkFile: null, lint }),
          },
        },
      },
    ]);
  }
  return results;
}

export default createNodesV2;

/** Normalize a glob-provided path to a canonical workspace-relative one. */
function normalizePath(file: string): string {
  const posix = file.replace(/\\/g, '/');
  return posix.startsWith('./') ? posix.slice(2) : posix;
}

/** Workspace-relative dir of a config file — '' for the root. */
function dirnameOf(file: string): string {
  const dir = dirname(file).replace(/\\/g, '/');
  return dir === '.' ? '' : dir;
}

/** Config paths ordered depth-first, then lexical — deterministic claims. */
function sortPathsByDepth(paths: readonly string[]): string[] {
  return [...paths].sort((a, b) => {
    const da = a.split('/').length;
    const db = b.split('/').length;
    return da !== db ? da - db : a.localeCompare(b);
  });
}

/** The `use` entries of a go.work, or none when it cannot be read. */
function readGoWork(absPath: string, workFile: string): string[] {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return [];
  }
  // A malformed go.work must not break the project graph — the parser
  // tolerates anything and simply finds no use entries.
  try {
    return parseGoWork(text);
  } catch {
    logger.warn(`[${PLUGIN_SCOPE}] Could not parse ${logSafe(workFile)} — ignoring it`);
    return [];
  }
}

/**
 * Resolve a `use` path against the go.work's dir into a workspace-relative
 * dir — null when it escapes the workspace. Accepts relative (`./app`,
 * `../shared`, `.`) and absolute paths.
 */
function resolveUseDir(workspaceRoot: string, workDir: string, usePath: string): string | null {
  const abs = resolve(join(workspaceRoot, workDir), usePath);
  const rel = relative(workspaceRoot, abs).replace(/\\/g, '/');
  // isSkippedDir covers `..` escapes; '' (the root, `use .`) is valid.
  return isSkippedDir(rel) ? null : rel;
}

/** node_modules, vendored trees and `..` escapes are never Go modules here. */
function isSkippedDir(dir: string): boolean {
  if (dir === '') return false;
  const segments = dir.split('/');
  return segments[0] === '..' || segments.includes('node_modules') || segments.includes('vendor');
}

/**
 * A value from a config file, safe to put into a log message — the config
 * is untrusted input, and a log line must stay one line.
 */
function logSafe(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 32 || code === 127 ? ' ' : char;
  }
  return out.trim();
}

export const __testing: { GO_GLOB: typeof GO_GLOB } = { GO_GLOB };
