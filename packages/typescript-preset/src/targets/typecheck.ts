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
    `{projectRoot}/src/**/*.ts`,
    `{projectRoot}/${options.configFile}`,
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
