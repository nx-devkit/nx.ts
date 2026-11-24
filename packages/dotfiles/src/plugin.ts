import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit';
import type { NxDevkitDotfilesOptions } from './types.ts';

// Marker files: chezmoi ships `.chezmoiversion` at the source-dir root;
// dotbot reads `install.conf.yaml` (or the hidden `.install.conf.yaml`).
const CONFIG_GLOB = '**/{.chezmoiversion,install.conf.yaml,.install.conf.yaml}';

const DOTBOT_CONFIG_NAMES = new Set(['install.conf.yaml', '.install.conf.yaml']);

function shouldSkipDir(projectRoot: string, workspaceRoot: string): boolean {
  if (isAbsolute(projectRoot)) return true;
  const rel = relative(workspaceRoot, resolve(workspaceRoot, projectRoot || '.'));
  if (rel === '') return false;
  const segments = rel.split(/[\\/]/);
  return segments.includes('..') || segments.includes('node_modules');
}

/** A dir is a chezmoi source dir when any `.chezmoi*` entry lives in it. */
function hasChezmoiFiles(dir: string, workspaceRoot: string, matchedFiles: string[]): boolean {
  if (matchedFiles.some((f) => basename(f) === '.chezmoiversion')) return true;
  try {
    return readdirSync(join(workspaceRoot, dir)).some((entry) => entry.startsWith('.chezmoi'));
  } catch {
    return false;
  }
}

function chezmoiTargets(): Record<string, TargetConfiguration> {
  // All three inspect or mutate the live home directory — never cache.
  return {
    'dotfiles:diff': {
      executor: 'nx:run-commands',
      cache: false,
      options: { command: 'chezmoi --source {projectRoot} diff', cwd: '{projectRoot}' },
    },
    'dotfiles:apply': {
      executor: 'nx:run-commands',
      cache: false,
      options: { command: 'chezmoi --source {projectRoot} apply', cwd: '{projectRoot}' },
    },
    'dotfiles:doctor': {
      executor: 'nx:run-commands',
      cache: false,
      options: { command: 'chezmoi --source {projectRoot} doctor', cwd: '{projectRoot}' },
    },
  };
}

/** dotbot runs through the conventional `./install` launcher when present. */
function dotbotTargets(
  dir: string,
  workspaceRoot: string,
  matchedFiles: string[],
): Record<string, TargetConfiguration> {
  const installPath = join(workspaceRoot, dir, 'install');
  const hasInstallScript =
    existsSync(installPath) &&
    statSync(installPath).isFile() &&
    (process.platform === 'win32' || (statSync(installPath).mode & 0o111) !== 0);
  const configName = matchedFiles
    .map((f) => basename(f))
    .filter((b) => DOTBOT_CONFIG_NAMES.has(b))
    .sort()
    .at(0);
  const command = hasInstallScript ? './install' : `dotbot -c ${configName ?? 'install.conf.yaml'}`;
  return {
    'dotfiles:install': {
      executor: 'nx:run-commands',
      cache: false,
      options: { command, cwd: '{projectRoot}' },
    },
  };
}

/**
 * Infer Nx targets from dotfiles-manager markers.
 *
 * - `.chezmoi*` in a directory → `dotfiles:diff`, `dotfiles:apply`,
 *   `dotfiles:doctor` (chezmoi).
 * - `install.conf.yaml` / `.install.conf.yaml` → `dotfiles:install`
 *   (dotbot via `./install` when the launcher exists, else `dotbot -c`).
 *
 * GNU stow layouts are deliberately not inferred in v1 — a stow repo has
 * no marker file, only conventions. Every target mutates or inspects the
 * live home directory, so nothing here is cacheable.
 */
export const createNodesV2: CreateNodesV2<NxDevkitDotfilesOptions> = [
  CONFIG_GLOB,
  (configFiles, _options = {}, context) => {
    const workspaceRoot = context.workspaceRoot;

    // One target set per owning directory — the lexically first marker wins
    // the result key, every marker in the dir contributes to detection.
    const byDir = new Map<string, string[]>();
    for (const raw of configFiles) {
      const configFile = raw.startsWith('./') ? raw.slice(2) : raw;
      const dir = dirname(configFile).replace(/\\/g, '/');
      const key = dir === '.' ? '' : dir;
      const list = byDir.get(key) ?? [];
      list.push(configFile);
      byDir.set(key, list);
    }

    const results: Array<readonly [string, { projects: Record<string, ProjectConfiguration> }]> =
      [];
    for (const [dir, files] of [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (shouldSkipDir(dir, workspaceRoot)) continue;

      const sorted = files.toSorted((a, b) => a.localeCompare(b));
      const winner = sorted.at(0);
      if (winner === undefined) continue;

      const targets: Record<string, TargetConfiguration> = {};
      if (hasChezmoiFiles(dir, workspaceRoot, sorted)) {
        Object.assign(targets, chezmoiTargets());
      }
      if (sorted.some((f) => DOTBOT_CONFIG_NAMES.has(basename(f)))) {
        Object.assign(targets, dotbotTargets(dir, workspaceRoot, sorted));
      }
      if (Object.keys(targets).length === 0) continue;

      results.push([winner, { projects: { [dir]: { root: dir, targets } } }]);
    }
    return results;
  },
];

export default createNodesV2;
