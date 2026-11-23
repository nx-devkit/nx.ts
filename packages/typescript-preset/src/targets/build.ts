import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// tsdown reads the project's tsconfig chain; `tsconfig*.json` covers
// solution-style variants (tsconfig.lib.json, tsconfig.build.json, …)
// and the workspace base covers `extends` hops outside the project.
const TSDOWN_INPUTS = [
  '{projectRoot}/src/**/*',
  '{projectRoot}/tsdown.config.*',
  '{projectRoot}/tsconfig*.json',
  '{workspaceRoot}/tsconfig.base.json',
  '{projectRoot}/package.json',
];

/**
 * Detects a publishable package that tsdown can build config-free.
 * tsdown falls back to `src/index.ts` as entry when no config exists,
 * so we require both a publishable signal and that conventional entry.
 */
export async function hasConfigFreeTsdownEntry(absProjectRoot: string): Promise<boolean> {
  // eslint-disable-next-line -- every failure mode (missing entry, missing/invalid package.json) intentionally returns false inside the try/catch
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed basenames joined to the Nx-provided project root
    await access(join(absProjectRoot, 'src/index.ts'));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed basename joined to the Nx-provided project root
    const pkg = JSON.parse(await readFile(join(absProjectRoot, 'package.json'), 'utf8'));
    return Boolean(pkg?.exports || pkg?.bin || (pkg?.main && pkg?.files));
  } catch {
    return false;
  }
}

export function inferTsdownBuildTarget(_projectRoot: string): {
  executor: string;
  options: Record<string, never>;
  outputs: string[];
  cache: true;
  inputs: string[];
  dependsOn: string[];
} {
  return {
    executor: '@nx-devkit/typescript:build',
    options: {},
    outputs: ['{projectRoot}/dist'],
    cache: true,
    inputs: [...TSDOWN_INPUTS],
    dependsOn: ['^build'],
  };
}

export function inferTsdownWatchTarget(_projectRoot: string): {
  executor: string;
  options: { watch: true };
  cache: false;
  continuous: true;
  readyWhen: { logMatches: string };
  inputs: string[];
  dependsOn: string[];
} {
  return {
    executor: '@nx-devkit/typescript:build',
    options: { watch: true },
    cache: false,
    // tsdown --watch is a long-running rebuild loop — mark it continuous
    // so dependents can declare it in `dependsOn` and start once ready.
    // tsdown logs "Build complete in <ms>" after the first successful
    // build; that line is the readiness signal.
    continuous: true,
    readyWhen: { logMatches: 'Build complete' },
    inputs: [...TSDOWN_INPUTS],
    dependsOn: ['^build'],
  };
}
