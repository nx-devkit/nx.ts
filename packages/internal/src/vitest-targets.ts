import { basename } from 'node:path'
import { VITEST_CONFIG_NAMES } from './config-discovery.ts'

export function inferVitestTargets(
  projectRoot: string,
  vitestConfigFile: string,
): {
  test: {
    executor: 'nx:run-commands'
    options: { command: string; cwd: string }
    outputs: string[]
    cache: true
    inputs: string[]
    dependsOn: string[]
  }
  'test:watch': {
    executor: 'nx:run-commands'
    options: { command: string; cwd: string }
    cache: false
    inputs: string[]
    dependsOn: string[]
  }
  'test:coverage': {
    executor: 'nx:run-commands'
    options: { command: string; cwd: string }
    outputs: string[]
    cache: true
    inputs: string[]
    dependsOn: string[]
  }
} {
  const configName = basename(vitestConfigFile)
  const workspaceVitestInputs = VITEST_CONFIG_NAMES.map((n) => `{workspaceRoot}/${n}`)
  const baseInputs = [
    // 'default' covers every project file — Vitest also discovers tests
    // outside src/ and tests/ (e.g. test/, __tests__/).
    'default',
    `{projectRoot}/${configName}`,
    ...workspaceVitestInputs,
  ]

  return {
    test: {
      executor: 'nx:run-commands',
      options: {
        command: 'vitest run',
        cwd: projectRoot,
      },
      outputs: ['{projectRoot}/coverage'],
      cache: true,
      inputs: baseInputs,
      dependsOn: ['^build'],
    },
    'test:watch': {
      executor: 'nx:run-commands',
      options: {
        command: 'vitest',
        cwd: projectRoot,
      },
      cache: false,
      inputs: baseInputs,
      dependsOn: ['^build'],
    },
    'test:coverage': {
      executor: 'nx:run-commands',
      options: {
        command: 'vitest run --coverage',
        cwd: projectRoot,
      },
      outputs: ['{projectRoot}/coverage'],
      cache: true,
      inputs: baseInputs,
      dependsOn: ['^build'],
    },
  }
}
