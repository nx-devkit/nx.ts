import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  logger,
  type CreateNodesResultArray,
  type CreateNodesV2,
  type ProjectConfiguration,
  type TargetConfiguration,
} from '@nx/devkit';
import { isVerbose, logDebug } from '@nx-devkit/internal';
import { parseDaggerJson, type DaggerJson } from './dagger-config.ts';
import { logSafe } from './log-safe.ts';
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

      const absPath = resolve(workspaceRoot, configFile);
      // Containment via relative(): a '..' segment anywhere or an
      // absolute remainder means the resolved path escaped the workspace.
      // Works on Windows too — resolve() emits backslashes there.
      const rel = relative(workspaceRoot, absPath);
      if (rel === '' || isAbsolute(rel) || rel.split(sep).includes('..')) {
        logDebug(
          PLUGIN_SCOPE,
          `Skipping ${logSafe(configFile)} — resolved path escapes the workspace`,
        );
        continue;
      }
      const config = readDaggerConfig(absPath, configFile);
      if (config === null) continue;

      const project: Partial<Pick<ProjectConfiguration, 'root' | 'name'>> & {
        targets: Record<string, TargetConfiguration>;
      } = {
        root: projectRoot,
        targets: buildCallTargets(config, {
          prefix,
          configFile,
          sourceInputs: moduleSourceInputs(
            config,
            projectRoot === '' ? '{workspaceRoot}' : '{projectRoot}',
            (source) => statKind(join(workspaceRoot, projectRoot, source)),
          ),
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
 * tracks the file itself). `sourceKind` consults the filesystem when
 * the path exists — a basename containing a dot is usually a file, but
 * directories like `src.v2` exist — and falls back to the basename
 * heuristic when it does not. Without `source` the sdk picks the
 * default — `go` keeps sources at the module root, the other SDKs live
 * under `src/`.
 */
export function moduleSourceInputs(
  config: DaggerJson,
  rootToken = '{projectRoot}',
  sourceKind: (source: string) => 'file' | 'dir' | undefined = () => undefined,
): string[] {
  if (config.source !== undefined) {
    const source = config.source.replace(/\\/g, '/').replace(/^\.\//, '');
    if (source === '' || source === '.') return [`${rootToken}/**/*`];
    const kind = sourceKind(source) ?? (basename(source).includes('.') ? 'file' : 'dir');
    return [kind === 'file' ? `${rootToken}/${source}` : `${rootToken}/${source}/**/*`];
  }
  if (config.sdk === 'go') return [`${rootToken}/**/*`];
  return [`${rootToken}/src/**/*`];
}

function statKind(absSource: string): 'file' | 'dir' | undefined {
  try {
    return statSync(absSource).isDirectory() ? 'dir' : 'file';
  } catch {
    return undefined;
  }
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

export const __testing: { DAGGER_GLOB: typeof DAGGER_GLOB } = { DAGGER_GLOB };
