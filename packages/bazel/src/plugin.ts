import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit';
import type { NxDevkitBazelOptions } from './types.ts';

const PLUGIN_NAME = '@nx-devkit/bazel';

/**
 * Config files the plugin reacts to — BUILD files carry the targets;
 * WORKSPACE/WORKSPACE.bazel/MODULE.bazel mark the Bazel workspace root
 * (so `//<pkg>` labels resolve against it) and re-trigger inference.
 */
export const BAZEL_GLOB = '**/{BUILD,BUILD.bazel,WORKSPACE,WORKSPACE.bazel,MODULE.bazel}';

const BUILD_FILE = /(^|\/)BUILD(\.bazel)?$/;
const WORKSPACE_MARKERS = ['WORKSPACE', 'WORKSPACE.bazel', 'MODULE.bazel'] as const;
/** Any `*_test(...)` rule call — cc_test, go_test, sh_test, custom rules. */
const TEST_RULE = /\b[A-Za-z_][A-Za-z0-9_]*_test\s*\(/;

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isBuildFile(configFile: string): boolean {
  return BUILD_FILE.test(configFile);
}

function dirOf(configFile: string): string {
  const dir = dirname(configFile).replace(/\\/g, '/');
  return dir === '.' ? '' : dir;
}

/** node_modules and paths escaping the workspace are never projects. */
function isSkippedDir(dir: string): boolean {
  const segments = dir.split('/');
  return segments[0] === '..' || segments.includes('..') || segments.includes('node_modules');
}

function* ancestors(dir: string): Generator<string> {
  let current = dir;
  for (;;) {
    yield current;
    if (current === '') return;
    const idx = current.lastIndexOf('/');
    current = idx === -1 ? '' : current.slice(0, idx);
  }
}

/**
 * The nearest ancestor of `dir` (including `dir` itself) holding a Bazel
 * workspace marker — the dir bazel's `//` labels are rooted at. Falls back
 * to the nx workspace root when no marker exists.
 */
function findBazelWorkspaceRoot(dir: string, workspaceRoot: string): string {
  for (const ancestor of ancestors(dir)) {
    for (const marker of WORKSPACE_MARKERS) {
      if (existsSync(join(workspaceRoot, ancestor, marker))) return ancestor;
    }
  }
  return '';
}

/** All workspace markers at or above `dir`, for input hashing. */
function collectMarkers(dir: string, workspaceRoot: string): string[] {
  const found: string[] = [];
  for (const ancestor of ancestors(dir)) {
    for (const marker of WORKSPACE_MARKERS) {
      if (existsSync(join(workspaceRoot, ancestor, marker))) {
        found.push(ancestor === '' ? marker : `${ancestor}/${marker}`);
      }
    }
  }
  return found;
}

/** Bazel package path for `//<pkg>:all`, relative to the bazel root. */
function bazelPackagePath(dir: string, bazelRoot: string): string {
  if (bazelRoot === '') return dir;
  if (dir === bazelRoot) return '';
  return dir.startsWith(`${bazelRoot}/`) ? dir.slice(bazelRoot.length + 1) : dir;
}

/** Does any BUILD file in `dir` declare a `*_test(...)` rule? */
function declaresTestRule(buildFiles: string[], workspaceRoot: string): boolean {
  for (const file of buildFiles) {
    try {
      if (TEST_RULE.test(readFileSync(join(workspaceRoot, file), 'utf8'))) return true;
    } catch {
      // Unreadable BUILD file — treat as no test rules rather than failing
      // project-graph creation.
    }
  }
  return false;
}

/**
 * Project name: the package.json `name` when the dir is also an npm
 * package (keeps one identity across plugins), otherwise
 * `bazel:<relpath>` — unique per dir by construction.
 */
function projectName(dir: string, workspaceRoot: string): string {
  const pkgPath = join(workspaceRoot, dir, 'package.json');
  try {
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: unknown };
      if (typeof pkg.name === 'string' && pkg.name !== '') return pkg.name;
    }
  } catch {
    // Fall through to the synthetic name.
  }
  return dir === '' ? 'bazel' : `bazel:${dir}`;
}

/**
 * Infer Nx targets from Bazel BUILD files — a narrow bridge for mixed
 * repos. No BUILD semantics, no bazel query: each dir with a BUILD file
 * gets `<prefix>:build` (`bazel build //<pkg>:all`) and, when the file
 * declares any `*_test` rule, `<prefix>:test` (`bazel test //<pkg>:all`).
 * `nx run-many -t bazel:build` then covers the bazel part of the repo and
 * `nx affected` works via the BUILD/.bzl inputs.
 */
export const createNodesV2: CreateNodesV2<NxDevkitBazelOptions> = [
  BAZEL_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot;
    const prefix = options.targetPrefix ?? 'bazel';

    // One project per owning directory — deterministic order.
    const byDir = new Map<string, string[]>();
    for (const configFile of [...configFiles].map(normalize).sort()) {
      if (!isBuildFile(configFile)) continue;
      const dir = dirOf(configFile);
      const list = byDir.get(dir) ?? [];
      list.push(configFile);
      byDir.set(dir, list);
    }

    const results: Array<readonly [string, { projects: Record<string, ProjectConfiguration> }]> =
      [];
    const sortedDirs = [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [dir, buildFiles] of sortedDirs) {
      if (isSkippedDir(dir)) continue;

      const configKey = buildFiles.at(0);
      if (configKey === undefined) continue;
      const pkg = bazelPackagePath(dir, findBazelWorkspaceRoot(dir, workspaceRoot));
      const label = `//${pkg}:all`;

      // dir's BUILD files + source globs minus bazel-* output symlinks;
      // ancestor workspace markers re-hash targets on workspace changes.
      const inputs = [
        '{projectRoot}/**',
        '!{projectRoot}/bazel-*',
        '!{projectRoot}/bazel-*/**',
        ...buildFiles.map((f) => `{projectRoot}/${f.slice(dir === '' ? 0 : dir.length + 1)}`),
        ...collectMarkers(dir, workspaceRoot).map((m) => `{workspaceRoot}/${m}`),
      ];

      const targets: Record<string, TargetConfiguration> = {
        [`${prefix}:build`]: {
          executor: 'nx:run-commands',
          cache: true,
          inputs,
          // Bazel is itself hermetic and owns its output tree (bazel-*
          // symlinks into output_user_root) — nothing for nx to capture.
          outputs: [],
          options: { command: `bazel build ${label}`, cwd: '{projectRoot}' },
        },
      };
      if (declaresTestRule(buildFiles, workspaceRoot)) {
        targets[`${prefix}:test`] = {
          executor: 'nx:run-commands',
          cache: true,
          inputs,
          outputs: [],
          options: { command: `bazel test ${label}`, cwd: '{projectRoot}' },
        };
      }

      results.push([
        configKey,
        {
          projects: {
            [dir]: { root: dir, name: projectName(dir, workspaceRoot), targets },
          },
        },
      ]);
    }
    return results;
  },
];

const plugin: { name: string; createNodesV2: typeof createNodesV2 } = {
  name: PLUGIN_NAME,
  createNodesV2,
};
export default plugin;
