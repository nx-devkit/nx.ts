import type { CreateNodesFunctionV2 } from 'nx/src/project-graph/plugins/public-api';
import { shouldSkipPath } from '@nx-devkit/internal';

const PLUGIN_NAME = '@nx-devkit/oxfmt';

// oxfmt auto-discovers exactly these config names, walking up the tree from
// each formatted file. `.js`/`.cjs`/`oxfmt.config.cts` files load only when
// passed via `oxfmt -c` — they are never searched for, so the glob below
// mirrors the tool's documented search set.
const OXFMT_CONFIG_BASENAMES = new Set([
  '.oxfmtrc.json',
  '.oxfmtrc.jsonc',
  'oxfmt.config.ts',
  'oxfmt.config.mts',
]);

const OXFMT_CONFIG_GLOB = '**/{.oxfmtrc.json,.oxfmtrc.jsonc,oxfmt.config.ts,oxfmt.config.mts}';

export interface OxfmtPluginOptions {
  formatCommand?: string;
  formatCheckCommand?: string;
}

export interface OxfmtTargetOptions {
  command: string;
  cwd: string;
}

export interface OxfmtTarget {
  executor: 'nx:run-commands';
  options: OxfmtTargetOptions;
  cache: boolean;
  inputs: string[];
}

export interface OxfmtProjectConfiguration {
  projects: Record<string, { targets: Record<string, OxfmtTarget> }>;
}

export type OxfmtCreateNodesResult = ReadonlyArray<readonly [string, OxfmtProjectConfiguration]>;

function isWorkspaceRoot(configFilePath: string): boolean {
  const normalized = configFilePath.replaceAll('\\', '/').replace(/^\.\//, '');
  return OXFMT_CONFIG_BASENAMES.has(normalized);
}

function inferOxfmtTargets(
  projectRoot: string,
  configFileBasename: string,
  options: OxfmtPluginOptions | undefined,
): Record<string, OxfmtTarget> {
  const formatCommand = options?.formatCommand ?? 'oxfmt --write .';
  const formatCheckCommand = options?.formatCheckCommand ?? 'oxfmt --check .';

  const configInput = `{projectRoot}/${configFileBasename}`;
  const baseInputs: string[] = [configInput, '{projectRoot}/**/*'];

  return {
    format: {
      executor: 'nx:run-commands',
      options: { command: formatCommand, cwd: projectRoot },
      cache: false,
      inputs: [...baseInputs],
    },
    'format-check': {
      executor: 'nx:run-commands',
      options: { command: formatCheckCommand, cwd: projectRoot },
      cache: true,
      inputs: [...baseInputs],
    },
  };
}

const createNodesFn: CreateNodesFunctionV2<OxfmtPluginOptions> = (
  configFiles,
  options,
  context,
) => {
  const workspaceRoot = context.workspaceRoot.replaceAll('\\', '/');
  const results: Array<readonly [string, OxfmtProjectConfiguration]> = [];
  const seenRoots = new Set<string>();

  // Sort so identical config sets infer identically — first seen root
  // wins, and caller order is filesystem-dependent.
  for (const configFile of [...configFiles].sort()) {
    const normalized = configFile.replaceAll('\\', '/');

    if (isWorkspaceRoot(normalized)) {
      continue;
    }

    const configFileBasename = normalized.split('/').pop() ?? '.oxfmtrc.json';
    if (!OXFMT_CONFIG_BASENAMES.has(configFileBasename)) {
      continue;
    }

    const projectRoot = normalized.replace(/^\.\//, '').replace(/\/[^/]+$/, '');
    if (shouldSkipPath(projectRoot, workspaceRoot)) {
      continue;
    }

    // oxfmt allows only one config file per directory — if several match,
    // the first glob hit owns the project entry.
    if (seenRoots.has(projectRoot)) {
      continue;
    }
    seenRoots.add(projectRoot);

    results.push([
      configFile,
      {
        projects: {
          [projectRoot]: {
            targets: inferOxfmtTargets(projectRoot, configFileBasename, options),
          },
        },
      },
    ]);
  }

  return results;
};

export const createNodesV2: readonly [
  typeof OXFMT_CONFIG_GLOB,
  CreateNodesFunctionV2<OxfmtPluginOptions>,
] = [OXFMT_CONFIG_GLOB, createNodesFn];

const plugin: { name: string; createNodesV2: typeof createNodesV2 } = {
  createNodesV2: createNodesV2,
  name: PLUGIN_NAME,
};
export default plugin;
