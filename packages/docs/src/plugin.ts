import { readFileSync } from 'node:fs';
import { basename, dirname, join, posix, relative, resolve } from 'node:path';
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit';

const PLUGIN_NAME = '@nx-devkit/docs';

export interface NxDocsPluginOptions {
  /** Target name prefix. Default: "docs" → `docs:dev`, `docs:build`, `docs:preview`. */
  targetPrefix?: string;
}

// VitePress keeps its config at <docsRoot>/.vitepress/config.* — the owning
// project is the PARENT of .vitepress. Astro (including Starlight, an astro
// integration) keeps astro.config.* at the project root.
const CONFIG_GLOB = '**/{.vitepress/config,astro.config}.{ts,js,mts,mjs,cjs,cts}';

type DocsTool = 'vitepress' | 'astro';

/**
 * Map a matched config file to its tool and owning project root.
 * `docs/.vitepress/config.ts` → vitepress on `docs`;
 * `site/astro.config.mjs` → astro on `site`. Anything else (e.g. a stray
 * `config.ts` outside `.vitepress`) is not a docs anchor.
 */
function matchConfig(configFile: string): { tool: DocsTool; projectRoot: string } | null {
  const normalized = configFile.replace(/\\/g, '/').replace(/^\.\//, '');
  const dir = dirname(normalized);
  const base = basename(normalized);
  if (/^astro\.config\.[cm]?[jt]s$/.test(base)) {
    return { tool: 'astro', projectRoot: dir === '.' ? '' : dir };
  }
  if (/^config\.[cm]?[jt]s$/.test(base) && basename(dir) === '.vitepress') {
    const parent = dirname(dir);
    return { tool: 'vitepress', projectRoot: parent === '.' ? '' : parent };
  }
  return null;
}

function shouldSkipDir(projectRoot: string, workspaceRoot: string): boolean {
  const rel = relative(workspaceRoot, resolve(workspaceRoot, projectRoot || '.'));
  if (rel === '') return false;
  const segments = rel.split(/[\\/]/);
  return segments.includes('..') || segments.includes('node_modules');
}

/** Starlight is an astro integration — same `astro` CLI, flagged via metadata. */
function isStarlightConfig(absPath: string): boolean {
  try {
    return /@astrojs\/starlight|\bstarlight\s*\(/.test(readFileSync(absPath, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Sniff a literal `outDir: '<dir>'` from the config so a custom build output
 * lands in the cached `outputs` — without it a cache hit restores nothing and
 * `docs:preview` fails. Only static string literals are detectable without
 * executing the config; anything else falls back to the tool defaults.
 * Returns null for absolute paths and `..` escapes (nothing under
 * `{projectRoot}` to declare) and for unreadable files.
 */
function sniffOutDir(absPath: string): string | null {
  try {
    // Strip comments so a commented-out example cannot win over the live value.
    const source = readFileSync(absPath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const match = /\boutDir\s*:\s*['"]([^'"]+)['"]/.exec(source);
    // Normalize so `foo/../public` collapses to `public`; a path that still
    // escapes the project root after normalization is rejected.
    const dir = match?.[1]?.replace(/\\/g, '/').replace(/\/+$/, '');
    if (dir === undefined) return null;
    const normalized = posix.normalize(dir);
    if (
      normalized === '.' ||
      normalized === '' ||
      normalized.startsWith('/') ||
      /^[a-zA-Z]:/.test(normalized) ||
      normalized.split('/').includes('..')
    ) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

function inferDocsTargets(
  prefix: string,
  tool: DocsTool,
  inputs: string[],
  outDir?: string,
): Record<string, TargetConfiguration> {
  const bin = tool === 'vitepress' ? 'vitepress' : 'astro';
  const buildName = `${prefix}:build`;
  // VitePress defaults to <root>/.vitepress/dist; `outDir: 'dist'` is the
  // common override, so both are declared. Astro builds to <root>/dist.
  // A literal `outDir` sniffed from the config adds its directory too.
  const outputs =
    tool === 'vitepress'
      ? ['{projectRoot}/.vitepress/dist', '{projectRoot}/dist']
      : ['{projectRoot}/dist'];
  if (outDir !== undefined) {
    const custom = `{projectRoot}/${outDir}`;
    if (!outputs.includes(custom)) outputs.push(custom);
  }

  return {
    [`${prefix}:dev`]: {
      executor: 'nx:run-commands',
      cache: false,
      continuous: true,
      options: { command: `npx ${bin} dev`, cwd: '{projectRoot}' },
    },
    [buildName]: {
      executor: 'nx:run-commands',
      cache: true,
      inputs,
      outputs,
      options: { command: `npx ${bin} build`, cwd: '{projectRoot}' },
    },
    [`${prefix}:preview`]: {
      executor: 'nx:run-commands',
      cache: false,
      continuous: true,
      dependsOn: [buildName],
      options: { command: `npx ${bin} preview`, cwd: '{projectRoot}' },
    },
  };
}

export const createNodesV2: CreateNodesV2<NxDocsPluginOptions> = [
  CONFIG_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot;
    const prefix = options.targetPrefix ?? 'docs';

    // Group matched configs by owning project root — deterministic order.
    const byRoot = new Map<string, Record<DocsTool, string[]>>();
    for (const configFile of [...configFiles].sort()) {
      const match = matchConfig(configFile);
      if (!match) continue;
      const entry = byRoot.get(match.projectRoot) ?? { astro: [], vitepress: [] };
      entry[match.tool].push(configFile);
      byRoot.set(match.projectRoot, entry);
    }

    const results: Array<readonly [string, { projects: Record<string, ProjectConfiguration> }]> =
      [];
    for (const [root, groups] of [...byRoot.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (shouldSkipDir(root, workspaceRoot)) continue;
      const project = buildProject(root, groups, prefix, workspaceRoot);
      if (project !== undefined) results.push(project);
    }
    return results;
  },
];

function buildProject(
  root: string,
  groups: Record<DocsTool, string[]>,
  prefix: string,
  workspaceRoot: string,
): readonly [string, { projects: Record<string, ProjectConfiguration> }] | undefined {
  // A root with both astro.config.* and .vitepress/config.* is a single
  // project — astro wins (starlight sites sometimes vendor vitepress
  // assets; the two target sets would collide on the same names anyway).
  const tool: DocsTool = groups.astro.length > 0 ? 'astro' : 'vitepress';
  const files = (tool === 'astro' ? groups.astro : groups.vitepress).toSorted((a, b) =>
    a.localeCompare(b),
  );
  const winner = files.at(0);
  if (winner === undefined) return undefined;

  const token = root ? '{projectRoot}' : '{workspaceRoot}';
  const rel = (f: string): string => (root ? f.slice(root.length + 1) : f);
  // **/* does not match dot-directories like .vitepress — list them
  // explicitly, alongside every matched config, so theme/config edits
  // bust the build cache. Outputs and tool caches are negated so a
  // previous build cannot poison the next hash. `^production` folds in
  // dependency projects' filesets — a docs site importing a workspace
  // library must re-hash when the library changes.
  const inputs =
    tool === 'vitepress'
      ? [
          `${token}/**/*`,
          `${token}/.vitepress/**/*`,
          `!${token}/.vitepress/dist`,
          `!${token}/.vitepress/cache`,
          `!${token}/dist`,
          `!${token}/node_modules`,
          ...files.map((f) => `${token}/${rel(f)}`),
          '^production',
        ]
      : [
          `${token}/**/*`,
          `!${token}/dist`,
          `!${token}/.astro`,
          `!${token}/node_modules`,
          ...files.map((f) => `${token}/${rel(f)}`),
          '^production',
        ];

  const absWinner = join(workspaceRoot, winner);
  const customOutDir = sniffOutDir(absWinner) ?? undefined;
  // A custom outDir is a build output too — negate it so it cannot
  // poison the input hash on the next run.
  if (customOutDir !== undefined) {
    const negated = `!${token}/${customOutDir}`;
    if (!inputs.includes(negated)) inputs.push(negated);
  }
  const starlight = tool === 'astro' && isStarlightConfig(absWinner);
  const project: ProjectConfiguration = {
    root,
    targets: inferDocsTargets(prefix, tool, inputs, customOutDir),
    metadata: { technologies: starlight ? ['astro', 'starlight'] : [tool] },
  };
  return [winner, { projects: { [root]: project } }];
}

const plugin: { name: string; createNodesV2: typeof createNodesV2 } = {
  name: PLUGIN_NAME,
  createNodesV2,
};
export default plugin;

export const __testing: {
  matchConfig: typeof matchConfig;
  CONFIG_GLOB: typeof CONFIG_GLOB;
} = {
  matchConfig: matchConfig,
  CONFIG_GLOB: CONFIG_GLOB,
};
