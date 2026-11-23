import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit';

export interface NxDeployPluginOptions {
  /** Name of the deploy target. Default: "deploy". */
  deployTargetName?: string;
  /** Name of the local dev-server target (providers that support one). Default: "dev". */
  devTargetName?: string;
}

const DEPLOY_GLOB = '**/{wrangler.toml,fly.toml,vercel.json,netlify.toml}';

type Provider = 'wrangler' | 'fly' | 'vercel' | 'netlify';

// Deterministic precedence when several provider configs live in one directory.
const PROVIDER_PRECEDENCE: readonly string[] = [
  'wrangler.toml',
  'fly.toml',
  'vercel.json',
  'netlify.toml',
];

const PROVIDER_BY_FILE: Record<string, Provider> = {
  'wrangler.toml': 'wrangler',
  'fly.toml': 'fly',
  'vercel.json': 'vercel',
  'netlify.toml': 'netlify',
};

const BUILD_DEP = 'build';

// CLIs are invoked by bare name — run-commands prepends node_modules/.bin to
// PATH (npm-run-path), so local and global installs both resolve. Credentials
// travel strictly via environment variables (CLOUDFLARE_API_TOKEN,
// FLY_API_TOKEN, VERCEL_TOKEN, NETLIFY_AUTH_TOKEN); no secret is ever placed
// on the command line.
const DEPLOY_COMMANDS: Record<Provider, string> = {
  wrangler: 'wrangler deploy',
  fly: 'flyctl deploy',
  vercel: 'vercel deploy --prod',
  netlify: 'netlify deploy --prod',
};

const DEV_COMMANDS: Partial<Record<Provider, string>> = {
  wrangler: 'wrangler dev',
  vercel: 'vercel dev',
};

function shouldSkipDir(projectRoot: string, workspaceRoot: string): boolean {
  // Unlike lint-style plugins, the workspace root IS a deployable project —
  // single-app repos keep their provider config at the repo root.
  const rel = relative(workspaceRoot, resolve(workspaceRoot, projectRoot || '.'));
  if (rel === '') return false;
  const segments = rel.split(/[\\/]/);
  return segments.includes('..') || segments.includes('node_modules');
}

function projectHasBuild(projectRoot: string, workspaceRoot: string): boolean {
  const dir = resolve(workspaceRoot, projectRoot || '.');
  try {
    const projectJson = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as {
      targets?: Record<string, unknown>;
    };
    if (projectJson.targets && BUILD_DEP in projectJson.targets) {
      return true;
    }
  } catch {
    // no readable project.json — fall through to package.json
  }
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    // nx/core/package-json materialises script names as nx:run-script targets.
    if (typeof pkg.scripts?.[BUILD_DEP] === 'string') return true;
  } catch {
    // no readable package.json — fall through to tsdown inference
  }
  // @nx-devkit/tsdown infers a `build` target from a tsdown config — the
  // manifest never mentions it, so detect the config file directly.
  return ['tsdown.config.ts', 'tsdown.config.mts', 'tsdown.config.js', 'tsdown.config.mjs'].some(
    (name) => existsSync(join(dir, name)),
  );
}

function deployTarget(command: string, hasBuild: boolean): TargetConfiguration {
  const target: TargetConfiguration = {
    executor: 'nx:run-commands',
    // Deploys are side effects against a provider — never cacheable.
    cache: false,
    options: {
      command,
      cwd: '{projectRoot}',
    },
  };
  if (hasBuild) {
    target.dependsOn = [BUILD_DEP];
  }
  return target;
}

function devTarget(command: string): TargetConfiguration {
  return {
    executor: 'nx:run-commands',
    cache: false,
    // Long-running dev server — dependents can gate on it via waitFor.
    continuous: true,
    options: {
      command,
      cwd: '{projectRoot}',
    },
  };
}

function providerRank(configFile: string): number {
  const idx = PROVIDER_PRECEDENCE.indexOf(basename(configFile));
  return idx === -1 ? PROVIDER_PRECEDENCE.length : idx;
}

export const createNodesV2: CreateNodesV2<NxDeployPluginOptions> = [
  DEPLOY_GLOB,
  (configFiles, options = {}, context) => {
    const workspaceRoot = context.workspaceRoot;
    const deployTargetName = options.deployTargetName ?? 'deploy';
    const devTargetName = options.devTargetName ?? 'dev';

    // Group candidate configs by owning directory — the highest-precedence
    // provider file wins the directory.
    const byDir = new Map<string, string[]>();
    for (const configFile of configFiles) {
      const dir = dirname(configFile).replace(/\\/g, '/');
      const list = byDir.get(dir) ?? [];
      list.push(configFile);
      byDir.set(dir, list);
    }

    const results: Array<readonly [string, { projects: Record<string, ProjectConfiguration> }]> =
      [];
    for (const [dir, files] of [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const projectRoot = dir === '.' ? '' : dir;
      if (shouldSkipDir(projectRoot, workspaceRoot)) continue;

      const winner = [...files].sort(
        (a, b) => providerRank(a) - providerRank(b) || a.localeCompare(b),
      )[0];
      if (winner === undefined) continue;
      const provider = PROVIDER_BY_FILE[basename(winner)];
      if (provider === undefined) continue;

      const targets: Record<string, TargetConfiguration> = {};
      targets[deployTargetName] = deployTarget(
        DEPLOY_COMMANDS[provider],
        projectHasBuild(projectRoot, workspaceRoot),
      );
      const devCommand = DEV_COMMANDS[provider];
      // Equal configured names must not let a dev server shadow a deploy.
      if (devCommand !== undefined && devTargetName !== deployTargetName) {
        targets[devTargetName] = devTarget(devCommand);
      }

      results.push([winner, { projects: { [projectRoot]: { root: projectRoot, targets } } }]);
    }
    return results;
  },
];

export default createNodesV2;

export const __testing: {
  DEPLOY_GLOB: typeof DEPLOY_GLOB;
  DEPLOY_COMMANDS: typeof DEPLOY_COMMANDS;
  DEV_COMMANDS: typeof DEV_COMMANDS;
  PROVIDER_PRECEDENCE: typeof PROVIDER_PRECEDENCE;
  shouldSkipDir: typeof shouldSkipDir;
  projectHasBuild: typeof projectHasBuild;
} = {
  DEPLOY_GLOB,
  DEPLOY_COMMANDS,
  DEV_COMMANDS,
  PROVIDER_PRECEDENCE,
  shouldSkipDir,
  projectHasBuild,
};
