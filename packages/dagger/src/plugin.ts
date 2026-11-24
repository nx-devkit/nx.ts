import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  logger,
  type CreateNodesResultArray,
  type CreateNodesV2,
  type ProjectConfiguration,
  type TargetConfiguration,
} from '@nx/devkit';
import { isVerbose, logDebug } from '@nx-devkit/internal';
import { parseDaggerJson, type DaggerJson } from './dagger-config.ts';
import { buildCallTargets } from './targets.ts';
import type { NxDevkitDaggerOptions } from './types.ts';

const PLUGIN_SCOPE = 'nx-devkit/dagger';

/** Config files the plugin reacts to — one dagger module per directory. */
export const DAGGER_GLOB = '**/dagger.json';

const DEFAULT_TARGET_PREFIX = 'dagger';

/**
 * Infer Nx targets from dagger.json.
 *
 * Each dagger.json marks a Dagger module. Declared `functions` fan out to
 * `<prefix>:call:<fn>` targets; a module without `functions` gets a single
 * `<prefix>:call` target. Targets are never cached (dagger calls have
 * side effects) but track the config and module source as inputs.
 */
export const createNodesV2: CreateNodesV2<NxDevkitDaggerOptions> = [
  DAGGER_GLOB,
  (configFiles, options, context): CreateNodesResultArray => {
    const workspaceRoot = context.workspaceRoot;
    const prefix = normalizePrefix(options?.targetPrefix);
    const results: CreateNodesResultArray = [];

    for (const rawConfigFile of [...configFiles].sort()) {
      // Nx's glob expander can emit a leading "./" — normalize so the path
      // stays canonical in inputs and result keys.
      const configFile = rawConfigFile.replace(/\\/g, '/').replace(/^\.\//, '');
      const dir = dirname(configFile).replace(/\\/g, '/');
      const projectRoot = dir === '.' ? '' : dir;
      if (isSkippedDir(projectRoot)) {
        logDebug(PLUGIN_SCOPE, `Skipping ${logSafe(configFile)} — not inside the workspace`);
        continue;
      }

      const config = readDaggerConfig(resolve(workspaceRoot, configFile), configFile);
      if (config === null) continue;

      const project: Partial<Pick<ProjectConfiguration, 'root' | 'name'>> & {
        targets: Record<string, TargetConfiguration>;
      } = {
        root: projectRoot,
        targets: buildCallTargets(config, {
          prefix,
          configFile,
          sourceInputs: moduleSourceInputs(config),
        }),
      };

      // dagger.json's `name` names the project — unless a package.json in
      // the same dir already owns the name.
      if (config.name !== undefined && !hasPackageJson(workspaceRoot, projectRoot)) {
        project.name = config.name;
      }

      results.push([configFile, { projects: { [projectRoot]: project } }]);
      if (isVerbose()) {
        logDebug(
          PLUGIN_SCOPE,
          `Registered ${logSafe(projectRoot || '.')} (${Object.keys(project.targets).join(', ')})`,
        );
      }
    }

    return results;
  },
];

export default createNodesV2;

/**
 * Module source inputs: a declared `source` wins (a dir tracks every
 * file under `<source>` recursively; a file path like `src/index.ts`
 * tracks the file itself). Without `source` the sdk picks the default —
 * `go` keeps sources at the module root, the other SDKs live under `src/`.
 */
export function moduleSourceInputs(config: DaggerJson): string[] {
  if (config.source !== undefined) {
    const source = config.source.replace(/\\/g, '/').replace(/^\.\//, '');
    if (source === '' || source === '.') return ['{projectRoot}/**/*'];
    return [
      basename(source).includes('.') ? `{projectRoot}/${source}` : `{projectRoot}/${source}/**/*`,
    ];
  }
  if (config.sdk === 'go') return ['{projectRoot}/**/*'];
  return ['{projectRoot}/src/**/*'];
}

function readDaggerConfig(absPath: string, configFile: string): DaggerJson | null {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  try {
    return parseDaggerJson(text, configFile);
  } catch {
    // A broken dagger.json must not break the project graph — warn and skip.
    logger.warn(`[${PLUGIN_SCOPE}] Could not parse ${logSafe(configFile)} — skipping it`);
    return null;
  }
}

function normalizePrefix(value: string | undefined): string {
  if (typeof value !== 'string') return DEFAULT_TARGET_PREFIX;
  const cleaned = value.replace(/^:+|:+$/g, '').trim();
  return cleaned === '' ? DEFAULT_TARGET_PREFIX : cleaned;
}

function hasPackageJson(workspaceRoot: string, projectRoot: string): boolean {
  return existsSync(join(workspaceRoot, projectRoot, 'package.json'));
}

/** node_modules and paths escaping the workspace are never modules. */
function isSkippedDir(projectRoot: string): boolean {
  if (projectRoot === '') return false;
  const segments = projectRoot.split('/');
  return segments[0] === '..' || segments.includes('..') || segments.includes('node_modules');
}

/**
 * A value from the config file, safe to put into a log message — the
 * config is untrusted input, and a log line must stay one line.
 */
function logSafe(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 32 || code === 127 ? ' ' : char;
  }
  return out.trim();
}

export const __testing: { DAGGER_GLOB: typeof DAGGER_GLOB } = { DAGGER_GLOB };
