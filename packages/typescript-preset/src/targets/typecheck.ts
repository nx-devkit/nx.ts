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
    // project root, *.mts/*.cts/*.tsx) — hash every TS source so the
    // typecheck cache is never stale.
    `{projectRoot}/**/*.{ts,tsx,mts,cts}`,
    `!{projectRoot}/dist`,
    `!{projectRoot}/node_modules`,
    `!{projectRoot}/coverage`,
    `{projectRoot}/${options.configFile}`,
    // Solution-style configs (tsconfig.lib.json, project references)
    // affect the compile even when they are not the detected configFile.
    `{projectRoot}/tsconfig*.json`,
    `{projectRoot}/package.json`,
    `{workspaceRoot}/tsconfig.base.json`,
  ];
  if (!options.tsgo) {
    inputs.push({ externalDependencies: ['typescript'] });
  } else if (nativeDep) {
    inputs.push({ externalDependencies: [nativeDep] });
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
