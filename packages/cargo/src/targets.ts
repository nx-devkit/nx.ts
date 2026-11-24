import type { TargetConfiguration } from '@nx/devkit';

/**
 * The inputs a cargo target hashes: the crate's manifest, sources and
 * build script, plus the Cargo.lock of the workspace that owns the
 * crate. The lockfile lives at the workspace root — `lockfileRoot` is
 * resolved by `resolveLockfileRoot` and equals `projectDir` for
 * standalone crates.
 */
export function crateInputs(projectDir: string, lockfileRoot: string): string[] {
  const inputs = ['{projectRoot}/Cargo.toml', '{projectRoot}/src/**/*', '{projectRoot}/build.rs'];
  inputs.push(
    lockfileRoot === projectDir
      ? '{projectRoot}/Cargo.lock'
      : `{workspaceRoot}/${lockfileRoot === '' ? 'Cargo.lock' : `${lockfileRoot}/Cargo.lock`}`,
  );
  return inputs;
}

/**
 * Inputs for the workspace-level targets of a virtual root manifest —
 * the root manifest and lockfile plus every member crate's manifest,
 * sources and build script.
 */
export function workspaceInputs(wsDir: string, memberDirs: string[]): string[] {
  const inputs = ['{projectRoot}/Cargo.toml', '{projectRoot}/Cargo.lock'];
  for (const member of memberDirs) {
    if (member === wsDir) {
      inputs.push('{projectRoot}/src/**/*', '{projectRoot}/build.rs');
      continue;
    }
    const rel = wsDir === '' ? member : member.slice(wsDir.length + 1);
    inputs.push(
      `{projectRoot}/${rel}/Cargo.toml`,
      `{projectRoot}/${rel}/src/**/*`,
      `{projectRoot}/${rel}/build.rs`,
    );
  }
  return dedupe(inputs);
}

/**
 * Crate targets — `build`, `test`, and (optionally) `clippy`/`fmt`.
 * Commands run with `cwd: '{projectRoot}'`; cargo discovers the owning
 * workspace by walking up, so `-p <name>` resolves in workspace context.
 * All targets are cacheable — cargo builds are deterministic per inputs
 * and `clippy`/`fmt`/`test` produce no project artifacts. Cargo's real
 * outputs live in the shared `target/` dir, so no outputs are declared.
 */
export function buildCrateTargets(
  name: string,
  options: { clippy: boolean; fmt: boolean },
  inputs: string[],
): Record<string, TargetConfiguration> {
  const cmd = (command: string): TargetConfiguration => ({
    executor: 'nx:run-commands',
    cache: true,
    inputs,
    outputs: [],
    options: { command, cwd: '{projectRoot}' },
  });

  const targets: Record<string, TargetConfiguration> = {
    build: cmd(`cargo build -p ${name}`),
    test: cmd(`cargo test -p ${name}`),
  };
  if (options.clippy) targets.clippy = cmd(`cargo clippy -p ${name} -- -D warnings`);
  if (options.fmt) targets.fmt = cmd(`cargo fmt -p ${name} -- --check`);
  return targets;
}

/**
 * Targets for a virtual `[workspace]` manifest — `cargo build` /
 * `cargo test` without `-p` build the workspace's default members.
 */
export function buildWorkspaceTargets(inputs: string[]): Record<string, TargetConfiguration> {
  const cmd = (command: string): TargetConfiguration => ({
    executor: 'nx:run-commands',
    cache: true,
    inputs,
    outputs: [],
    options: { command, cwd: '{projectRoot}' },
  });
  return {
    build: cmd('cargo build'),
    test: cmd('cargo test'),
  };
}

function dedupe(inputs: string[]): string[] {
  return [...new Set(inputs)];
}
