import type { TargetConfiguration } from '@nx/devkit'

export interface InferHuskyTargetOptions {
  /** Path to the project root. Default: project root. */
  projectRoot?: string
  /** Glob for pre-commit files. Default: pre-commit. */
  hookGlob?: string
}

const _HUSKY_INPUTS = ['{projectRoot}/.husky/pre-commit', '{workspaceRoot}/.husky/pre-commit']

export function inferHuskyTarget(
  projectRoot: string,
  options: InferHuskyTargetOptions = {},
): TargetConfiguration {
  const _hookGlob = options.hookGlob ?? 'pre-commit'

  return {
    executor: 'nx:run-commands',
    options: {
      commands: ['echo "Running pre-commit hooks..."', 'npx lint-staged'],
      cwd: projectRoot,
    },
    inputs: [
      '{projectRoot}/.husky/pre-commit',
      '{workspaceRoot}/.husky/pre-commit',
      '{projectRoot}/package.json',
      '{workspaceRoot}/package.json',
    ],
    outputs: [],
    cache: true,
  }
}

export function inferHuskyPrepareTarget(projectRoot: string): TargetConfiguration {
  return {
    executor: 'nx:run-commands',
    options: {
      command: 'husky',
      cwd: projectRoot,
    },
    inputs: ['{projectRoot}/package.json'],
    outputs: ['{projectRoot}/.husky'],
    cache: true,
  }
}

export function inferHuskyInstallTarget(projectRoot: string): TargetConfiguration {
  return {
    executor: 'nx:run-commands',
    options: {
      command: 'npm pkg set scripts.prepare="husky"',
      cwd: projectRoot,
    },
    inputs: ['{projectRoot}/package.json'],
    outputs: ['{projectRoot}/.husky'],
    cache: true,
  }
}

export function inferHuskyHookTarget(projectRoot: string): TargetConfiguration {
  return {
    executor: 'nx:run-commands',
    options: {
      commands: [
        'mkdir -p .husky',
        'echo "#!/bin/sh" > .husky/pre-commit',
        'echo "npx lint-staged" >> .husky/pre-commit',
        'chmod +x .husky/pre-commit',
      ],
      cwd: projectRoot,
    },
    inputs: ['{projectRoot}/package.json'],
    outputs: ['{projectRoot}/.husky/pre-commit'],
    cache: true,
  }
}

export function inferHuskyLintStagedTarget(projectRoot: string): TargetConfiguration {
  return {
    executor: 'nx:run-commands',
    options: {
      command: 'npm pkg set "lint-staged[*.{ts,js,json,md}]"="prettier --write"',
      cwd: projectRoot,
    },
    inputs: ['{projectRoot}/package.json'],
    outputs: ['{projectRoot}/package.json'],
    cache: true,
  }
}

export function inferAllHuskyTargets(projectRoot: string): Record<string, TargetConfiguration> {
  return {
    'husky:prepare': inferHuskyPrepareTarget(projectRoot),
    'husky:install': inferHuskyInstallTarget(projectRoot),
    'husky:hooks': inferHuskyHookTarget(projectRoot),
    'husky:lint-staged': inferHuskyLintStagedTarget(projectRoot),
  }
}
