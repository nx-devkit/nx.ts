import type { CreateNodesV2 } from '@nx/devkit'

export interface NxDevkitTypescriptOptions {
  tsgo?: boolean
  configFile?: string
  clean?: boolean
}

export declare const createNodesV2: CreateNodesV2<NxDevkitTypescriptOptions>

export declare function inferTypecheckTarget(
  projectRoot: string,
  configFile: string,
  options: Required<Pick<NxDevkitTypescriptOptions, 'tsgo' | 'configFile' | 'clean'>>,
): {
  executor: 'nx:run-commands'
  options: { command: string; cwd: string }
  cache: true
  inputs: (string | { externalDependencies: string[] })[]
}

export declare function inferVitestTargets(
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
}

export declare function shouldSkipPath(projectRoot: string, workspaceRoot: string): boolean

export declare function isVerbose(): boolean

export declare function logDebug(scope: string, message: string): void
