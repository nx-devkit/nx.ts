import type { TargetConfiguration } from '@nx/devkit';

/**
 * The inputs a cargo target hashes: the crate's manifest, sources,
 * tests, examples and build script — plus the manifest and Cargo.lock
 * of the workspace that owns the crate (workspace deps, profiles and
 * `[patch]` live there) and the manifest and sources of every path
 * dependency (`depDirs`). Cargo reads all of these; leaving one out
 * lets a changed file replay a stale cached result.
 *
 * The lockfile lives at the workspace root — `lockfileRoot` is resolved
 * by `resolveLockfileRoot` and equals `projectDir` for standalone
 * crates.
 */
export function crateInputs(projectDir: string, lockfileRoot: string, depDirs: string[]): string[] {
  const inputs = [
    '{projectRoot}/Cargo.toml',
    '{projectRoot}/src/**/*',
    '{projectRoot}/tests/**/*',
    '{projectRoot}/examples/**/*',
    '{projectRoot}/build.rs',
  ];
  if (lockfileRoot === projectDir) {
    inputs.push('{projectRoot}/Cargo.lock');
  } else {
    const ws = lockfileRoot === '' ? '' : `${lockfileRoot}/`;
    inputs.push(`{workspaceRoot}/${ws}Cargo.toml`, `{workspaceRoot}/${ws}Cargo.lock`);
  }
  for (const dep of depDirs) {
    if (dep === projectDir) continue;
    const dir = dep === '' ? '' : `${dep}/`;
    inputs.push(
      `{workspaceRoot}/${dir}Cargo.toml`,
      `{workspaceRoot}/${dir}src/**/*`,
      `{workspaceRoot}/${dir}build.rs`,
    );
  }
  return dedupe(inputs);
}

/**
 * Inputs for the workspace-level targets of a virtual root manifest —
 * the root manifest and lockfile plus every member crate's manifest,
 * sources, tests, examples and build script.
 */
export function workspaceInputs(wsDir: string, memberDirs: string[]): string[] {
  const inputs = ['{projectRoot}/Cargo.toml', '{projectRoot}/Cargo.lock'];
  for (const member of memberDirs) {
    if (member === wsDir) {
      inputs.push(
        '{projectRoot}/src/**/*',
        '{projectRoot}/tests/**/*',
        '{projectRoot}/examples/**/*',
        '{projectRoot}/build.rs',
      );
      continue;
    }
    const rel = wsDir === '' ? member : member.slice(wsDir.length + 1);
    inputs.push(
      `{projectRoot}/${rel}/Cargo.toml`,
      `{projectRoot}/${rel}/src/**/*`,
      `{projectRoot}/${rel}/tests/**/*`,
      `{projectRoot}/${rel}/examples/**/*`,
      `{projectRoot}/${rel}/build.rs`,
    );
  }
  return dedupe(inputs);
}

/**
 * Crate targets — `build`, `test`, and (optionally) `clippy`/`fmt`.
 * Commands run with `cwd: '{projectRoot}'`; cargo discovers the owning
 * workspace by walking up, so `-p <name>` resolves in workspace context.
 *
 * `build` is never cached: its product is the shared `target/` dir,
 * which is never a declared output, so a cache hit would report success
 * while restoring nothing. `test`/`clippy`/`fmt` are cacheable — their
 * result is the terminal output itself, so replaying it is correct.
 * Cargo's own incremental build keeps an uncached `build` cheap.
 */
export function buildCrateTargets(
  name: string,
  options: { clippy: boolean; fmt: boolean },
  inputs: string[],
): Record<string, TargetConfiguration> {
  const cmd = (command: string, cache: boolean): TargetConfiguration => ({
    executor: 'nx:run-commands',
    cache,
    inputs,
    outputs: [],
    options: { command, cwd: '{projectRoot}' },
  });

  const targets: Record<string, TargetConfiguration> = {
    build: cmd(`cargo build -p ${name}`, false),
    test: cmd(`cargo test -p ${name}`, true),
  };
  if (options.clippy) targets.clippy = cmd(`cargo clippy -p ${name} -- -D warnings`, true);
  if (options.fmt) targets.fmt = cmd(`cargo fmt -p ${name} -- --check`, true);
  return targets;
}

/**
 * Targets for a virtual `[workspace]` manifest — `cargo build` /
 * `cargo test` without `-p` build the workspace's default members.
 * `build` is uncached for the same reason as crate targets.
 */
export function buildWorkspaceTargets(inputs: string[]): Record<string, TargetConfiguration> {
  const cmd = (command: string, cache: boolean): TargetConfiguration => ({
    executor: 'nx:run-commands',
    cache,
    inputs,
    outputs: [],
    options: { command, cwd: '{projectRoot}' },
  });
  return {
    build: cmd('cargo build', false),
    test: cmd('cargo test', true),
  };
}

function dedupe(inputs: string[]): string[] {
  return [...new Set(inputs)];
}
