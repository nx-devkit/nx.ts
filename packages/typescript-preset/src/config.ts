import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export { findConfigFile, findVitestConfig } from '@nx-devkit/internal';

export const OXLINTRC_NAMES = [
  '.oxlintrc.json',
  '.oxlintrc.jsonc',
  '.oxlintrc.yaml',
  '.oxlintrc.yml',
  '.oxlintrc.js',
  '.oxlintrc.mjs',
  '.oxlintrc.cjs',
  '.oxlintrc.ts',
  '.oxlintrc.mts',
  '.oxlintrc.cts',
];

export const ESLINT_CONFIG_NAMES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
];

export const BIOME_CONFIG_NAMES = ['biome.json', 'biome.jsonc'];

export const TSDOWN_CONFIG_NAMES = [
  'tsdown.config.ts',
  'tsdown.config.js',
  'tsdown.config.mts',
  'tsdown.config.mjs',
  'tsdown.config.cts',
  'tsdown.config.cjs',
];

/**
 * Which dependency supplies the native TypeScript compiler for a project:
 * `'@typescript/native'` (typescript@7 — native `tsc`, the recommended
 * side-by-side alias) or the legacy `'@typescript/native-preview` (`tsgo`).
 * `false` when neither is declared.
 */
function declaredNativeDep(pkg: Record<string, unknown>): string | false {
  const allDeps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
    ...(pkg.peerDependencies as Record<string, string> | undefined),
  };
  if ('@typescript/native' in allDeps) return '@typescript/native';
  if ('@typescript/native-preview' in allDeps) return '@typescript/native-preview';
  return false;
}

export async function detectNativeTypescript(
  projectRoot: string,
  workspaceRoot: string,
): Promise<string | false> {
  // Project manifest wins; the workspace root manifest is the fallback —
  // the init/package generators declare the compiler in root devDeps so
  // every project shares it. Without the fallback the typecheck target's
  // hashed externalDependencies would never see a root-declared compiler.
  for (const dir of [resolve(workspaceRoot, projectRoot), resolve(workspaceRoot)]) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a package.json under a known workspace root
      const content = await readFile(join(dir, 'package.json'), 'utf8');
      const dep = declaredNativeDep(JSON.parse(content) as Record<string, unknown>);
      if (dep) return dep;
    } catch {
      // no manifest at this level — keep looking
    }
  }
  return false;
}

/**
 * Check if a native TypeScript compiler (`@typescript/native` or the
 * legacy `@typescript/native-preview`) is listed in the project's
 * package.json.
 */
export async function checkNativePreview(
  projectRoot: string,
  workspaceRoot: string,
): Promise<boolean> {
  return (await detectNativeTypescript(projectRoot, workspaceRoot)) !== false;
}
