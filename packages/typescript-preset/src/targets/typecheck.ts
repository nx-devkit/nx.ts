import type { NxDevkitTypescriptOptions } from '../types.js';

export function inferTypecheckTarget(
  projectRoot: string,
  options: Required<Pick<NxDevkitTypescriptOptions, 'tsgo' | 'configFile' | 'clean'>>,
  nativeDep: string | false = '@typescript/native',
): {
  executor: string;
  options: { tsgo: boolean; configFile: string; clean: boolean };
  cache: true;
  inputs: (string | { externalDependencies: string[] })[];
} {
  const inputs: (string | { externalDependencies: string[] })[] = [
    // tsconfig `include` reaches beyond src/ (test/, config files at the
    // project root, *.mts/*.cts/*.tsx) and `allowJs`/`checkJs`/
    // `resolveJsonModule` pull in JS and JSON — hash every compilable
    // source so the typecheck cache is never stale.
    `{projectRoot}/**/*.{ts,tsx,mts,cts,js,jsx,cjs,mjs,json}`,
    `!{projectRoot}/dist`,
    `!{projectRoot}/node_modules`,
    `!{projectRoot}/coverage`,
    `{projectRoot}/${options.configFile}`,
    // Solution-style configs at the project root (tsconfig.lib.json)
    // affect the compile even when they are not the detected configFile.
    // Project references into sibling projects (`references: [{ path:
    // '../lib' }]`) live outside `{projectRoot}` — their sources are
    // hashed through the referenced project's own targets.
    `{projectRoot}/tsconfig*.json`,
    `{projectRoot}/package.json`,
    `{workspaceRoot}/tsconfig.base.json`,
  ];
  if (!options.tsgo) {
    inputs.push({ externalDependencies: ['typescript'] });
  } else if (nativeDep) {
    inputs.push({ externalDependencies: [nativeDep] });
  } else {
    // tsgo preferred but no native compiler declared — the executor's
    // install-based detectCompiler can still resolve a transitively
    // installed native package, else it falls back to `typescript`.
    // Hash every candidate so a compiler upgrade always busts the cache.
    inputs.push({
      externalDependencies: ['typescript', '@typescript/native', '@typescript/native-preview'],
    });
  }

  return {
    executor: '@nx-devkit/typescript:typecheck',
    options: {
      tsgo: options.tsgo,
      configFile: options.configFile,
      clean: options.clean,
    },
    cache: true,
    inputs,
  };
}
