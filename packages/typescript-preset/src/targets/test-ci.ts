import type { TargetConfiguration } from '@nx/devkit';

export interface TestCiOptions {
  /** Aggregate group target name, e.g. `test-ci`. */
  ciTargetName: string;
  /** Project-root-relative test file paths (posix), one target each. */
  files: readonly string[];
  /** Shell command for one file — the atomized target's `command`. */
  command: (file: string) => string;
  /** Cache inputs shared by the group and every per-file target. */
  inputs: TargetConfiguration['inputs'];
  /** Cache outputs shared by the group and every per-file target. */
  outputs?: string[];
  /** Technology labels attached to target metadata (e.g. `['vitest']`). */
  technologies?: string[];
}

export interface TestCiTargets {
  /** `ciTargetName` group plus one `${ciTargetName}--<file>` per file. */
  targets: Record<string, TargetConfiguration>;
  /** Group-first ordered names for `metadata.targetGroups`. */
  group: string[];
}

/**
 * Atomizer-style CI group, mirroring `@nx/playwright`'s `ciTargetName`:
 * a `nx:noop` group target whose `dependsOn` fans out to one cacheable
 * target per test file, so Nx DTE can shard single files across agents.
 * Every per-file target is also individually runnable
 * (`nx run proj:test-ci--src/a.spec.ts`).
 */
export function inferTestCiTargets(projectRoot: string, options: TestCiOptions): TestCiTargets {
  const { ciTargetName } = options;
  const targets: Record<string, TargetConfiguration> = {};
  const group: string[] = [ciTargetName];

  const dependsOn: TargetConfiguration['dependsOn'] = [];
  for (const file of options.files) {
    const name = `${ciTargetName}--${file}`;
    group.push(name);
    dependsOn.push({ target: name, params: 'forward' });
    // eslint-disable-next-line security/detect-object-injection -- name derives from a glob-matched workspace file
    targets[name] = {
      executor: 'nx:run-commands',
      options: {
        command: options.command(file),
        cwd: projectRoot,
      },
      cache: true,
      inputs: options.inputs ? [...options.inputs] : undefined,
      metadata: {
        ...(options.technologies ? { technologies: options.technologies } : {}),
        description: `Run tests in ${file}`,
        nonAtomizedTarget: ciTargetName,
      },
    };
  }

  // eslint-disable-next-line security/detect-object-injection -- ciTargetName is workspace-authored plugin config
  targets[ciTargetName] = {
    executor: 'nx:noop',
    cache: true,
    inputs: options.inputs ? [...options.inputs] : undefined,
    ...(options.outputs ? { outputs: [...options.outputs] } : {}),
    dependsOn,
    metadata: {
      ...(options.technologies ? { technologies: options.technologies } : {}),
      description: `Run all tests (atomized)`,
    },
  };

  return { targets, group };
}
