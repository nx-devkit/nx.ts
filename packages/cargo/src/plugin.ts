import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  logger,
  type CreateNodesResultArray,
  type CreateNodesV2,
  type ProjectConfiguration,
} from '@nx/devkit';
import { isVerbose, logDebug } from '@nx-devkit/internal';
import { parseCargoToml, type CargoManifest } from './cargo-toml.ts';
import { collectPathDeps, expandMembers, readManifest, resolveLockfileRoot } from './workspace.ts';
import {
  buildCrateTargets,
  buildWorkspaceTargets,
  crateInputs,
  workspaceInputs,
} from './targets.ts';
import type { NxDevkitCargoOptions } from './types.ts';

const PLUGIN_SCOPE = 'nx-devkit/cargo';
const PLUGIN_NAME = '@nx-devkit/cargo';

/** Config files the plugin reacts to — every Cargo.toml in the workspace. */
export const CARGO_GLOB = '**/Cargo.toml';

/**
 * Infer Nx targets from Cargo.toml.
 *
 * Every `[package]` manifest becomes a project named after the package,
 * with `build`/`test`/`clippy`/`fmt` targets running `cargo <sub> -p
 * <name>` from the crate dir — cargo discovers the owning workspace
 * itself. A `[workspace]` manifest without `[package]` is a virtual
 * root: it gets workspace-level `build`/`test` targets running cargo
 * without `-p` over the default members.
 *
 * `[workspace] members`/`exclude` globs decide which lockfile a crate's
 * targets hash and which sources feed the virtual root's inputs. `path`
 * dependencies (including `workspace = true` inheritance) become
 * `implicitDependencies` edges so `nx affected` and `nx graph` see the
 * crate graph.
 */
export const createNodesV2: CreateNodesV2<NxDevkitCargoOptions> = [
  CARGO_GLOB,
  (configFiles, options = {}, context): CreateNodesResultArray => {
    const workspaceRoot = context.workspaceRoot;
    const clippy = options.clippy ?? true;
    const fmt = options.fmt ?? true;

    // 1. Parse every matched manifest. Keyed by posix dir; '' is the
    //    workspace root.
    const manifests = new Map<string, CargoManifest>();
    const manifestFiles = new Map<string, string>();
    for (const rawConfigFile of [...configFiles].sort()) {
      const configFile = normalize(rawConfigFile);
      const dir = normalize(dirname(configFile));
      if (isSkippedDir(dir)) {
        logDebug(PLUGIN_SCOPE, `Skipping ${logSafe(configFile)} — not inside the workspace`);
        continue;
      }
      const manifest = readManifestFile(join(workspaceRoot, configFile), configFile);
      if (manifest === null) continue;
      manifests.set(dir, manifest);
      manifestFiles.set(dir, configFile);
    }

    // Lazily resolve manifests outside the matched set — members can be
    // nxignored and path deps can point at dirs the glob did not feed us.
    const diskCache = new Map<string, CargoManifest | null>();
    const manifestAt = (dir: string): CargoManifest | null => {
      const matched = manifests.get(dir);
      if (matched !== undefined) return matched;
      let cached = diskCache.get(dir);
      if (cached === undefined) {
        cached = readManifest(join(workspaceRoot, dir, 'Cargo.toml'));
        diskCache.set(dir, cached);
      }
      return cached;
    };

    // Lazily expand a workspace root's member dirs — one filesystem walk
    // per root, shared by lockfile resolution and virtual-root inputs.
    const memberCache = new Map<string, string[]>();
    const membersOf = (wsDir: string, manifest: CargoManifest): string[] => {
      let members = memberCache.get(wsDir);
      if (members === undefined) {
        members = expandMembers(
          workspaceRoot,
          wsDir,
          manifest.workspace?.members ?? [],
          manifest.workspace?.exclude ?? [],
          manifest.packageName !== undefined,
        );
        memberCache.set(wsDir, members);
      }
      return members;
    };

    const results: CreateNodesResultArray = [];
    for (const dir of [...manifests.keys()].sort()) {
      const manifest = manifests.get(dir);
      const configFile = manifestFiles.get(dir);
      if (manifest === undefined || configFile === undefined) continue;

      const projects: Record<string, ProjectConfiguration> = {};
      if (manifest.packageName !== undefined) {
        const lockfileRoot = resolveLockfileRoot(dir, manifest, manifestAt, membersOf);
        const implicitDependencies = collectPathDeps(manifest, dir, lockfileRoot, manifestAt);
        const project: ProjectConfiguration = {
          root: dir,
          name: manifest.packageName,
          targets: buildCrateTargets(
            manifest.packageName,
            { clippy, fmt },
            crateInputs(dir, lockfileRoot),
          ),
        };
        if (implicitDependencies.length > 0) project.implicitDependencies = implicitDependencies;
        projects[dir] = project;
        if (isVerbose()) {
          logDebug(PLUGIN_SCOPE, `Registered crate ${logSafe(dir || '.')}:${manifest.packageName}`);
        }
      } else if (manifest.workspace !== null) {
        // Virtual workspace root — workspace-level build/test, no -p.
        const members = membersOf(dir, manifest);
        projects[dir] = {
          root: dir,
          targets: buildWorkspaceTargets(workspaceInputs(dir, members)),
        };
        if (isVerbose()) {
          logDebug(PLUGIN_SCOPE, `Registered virtual workspace ${logSafe(dir || '.')}`);
        }
      }
      if (Object.keys(projects).length > 0) {
        results.push([configFile, { projects }]);
      }
    }

    return results;
  },
];

const plugin: { name: string; createNodesV2: typeof createNodesV2 } = {
  name: PLUGIN_NAME,
  createNodesV2,
};
export default plugin;

function normalize(path: string): string {
  const out = path.replaceAll('\\', '/').replace(/^\.\//, '');
  return out === '.' ? '' : out;
}

/** node_modules and paths escaping the workspace are never crates. */
function isSkippedDir(dir: string): boolean {
  const segments = dir.split('/');
  return segments[0] === '..' || segments.includes('node_modules');
}

function readManifestFile(absPath: string, configFile: string): CargoManifest | null {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  try {
    return parseCargoToml(text);
  } catch {
    // A broken Cargo.toml must not break the project graph — warn and skip.
    logger.warn(`[${PLUGIN_SCOPE}] Could not parse ${logSafe(configFile)} — skipping it`);
    return null;
  }
}

/**
 * A value from the manifest, safe to put into a log message — the
 * manifest is untrusted input, and a log line must stay one line.
 */
function logSafe(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 32 || code === 127 ? ' ' : char;
  }
  return out.trim();
}

export const __testing: { CARGO_GLOB: typeof CARGO_GLOB } = { CARGO_GLOB };
