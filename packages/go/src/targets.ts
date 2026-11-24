import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TargetConfiguration } from '@nx/devkit';

/** golangci-lint auto-discovers these config names from the working dir upward. */
export const GOLANGCI_CONFIG_NAMES = ['.golangci.yml', '.golangci.yaml', '.golangci.json'] as const;

/** Everything a module dir → target mapping needs beyond the dir itself. */
export interface ModuleTargetContext {
  /** Absolute workspace root — used for golangci detection and GOWORK. */
  workspaceRoot: string;
  /**
   * Workspace-relative path of the go.work claiming the module, or null for
   * a standalone module. Members hash the work file (and go.work.sum) and
   * run with `GOWORK` pinned to it — go otherwise discovers a go.work only
   * from cwd upward, which misses sibling workspaces or picks a different
   * one than the file Nx hashed.
   */
  goWorkFile: string | null;
  /**
   * Every dir claimed by the same go.work (including this module).
   * Workspace builds resolve imports across members, so sibling sources
   * are hashed as inputs.
   */
  memberDirs?: readonly string[];
  /** Whether to infer the golangci-lint `lint` target (options.lint). */
  lint: boolean;
}

/**
 * Files `go build`/`test`/`vet` can read inside a module dir: sources,
 * `//go:embed` assets and CGo files — i.e. everything except vendored,
 * node_modules and .git trees (skipped dirs and tool-owned paths are
 * never module inputs).
 */
function dirInputs(prefix: string): string[] {
  return [
    `${prefix}/go.mod`,
    `${prefix}/go.sum`,
    `${prefix}/**/*`,
    `!${prefix}/**/vendor/**/*`,
    `!${prefix}/**/node_modules/**/*`,
    `!${prefix}/**/.git/**/*`,
  ];
}

/**
 * Module dir → build/test/vet/lint targets. Commands run with
 * `cwd: '{projectRoot}'` and `GOWORK` pinning the attributed work file
 * (`off` for standalone modules) — no flags or paths are interpolated
 * into argv; `go` and `golangci-lint` resolve their module and config
 * context from the working directory. lint appears only when
 * `options.lint` allows it and a `.golangci.{yml,yaml,json}` exists in
 * the module dir or an ancestor up to the workspace root
 * (golangci-lint searches upward).
 */
export function buildModuleTargets(
  moduleDir: string,
  ctx: ModuleTargetContext,
): Record<string, TargetConfiguration> {
  const inputs = buildInputs(moduleDir, ctx);
  const options = {
    cwd: '{projectRoot}',
    env: {
      GOWORK: ctx.goWorkFile === null ? 'off' : join(ctx.workspaceRoot, ctx.goWorkFile),
    },
  };
  const targets: Record<string, TargetConfiguration> = {
    build: cachedTarget('go build ./...', inputs, options),
    test: cachedTarget('go test ./...', inputs, options),
    vet: cachedTarget('go vet ./...', inputs, options),
  };

  if (ctx.lint) {
    const config = findGolangciConfig(moduleDir, ctx.workspaceRoot);
    if (config !== null) {
      targets['lint'] = cachedTarget(
        'golangci-lint run ./...',
        [...inputs, `{workspaceRoot}/${config}`],
        options,
      );
    }
  }
  return targets;
}

function cachedTarget(
  command: string,
  inputs: string[],
  options: { cwd: string; env: Record<string, string> },
): TargetConfiguration {
  return {
    executor: 'nx:run-commands',
    cache: true,
    inputs,
    options: { command, ...options },
  };
}

/**
 * Module sources plus — for workspace members — the go.work and the
 * go.work.sum sitting next to it (`<dir>/go.work` → `<dir>/go.work.sum`,
 * `go.work` → `go.work.sum`), and the fileset of every other member the
 * same go.work claims (workspace builds read sibling member sources).
 * The root module ('' dir) uses `{workspaceRoot}` prefixes — repo
 * convention for the root project.
 */
function buildInputs(moduleDir: string, ctx: ModuleTargetContext): string[] {
  const prefix = moduleDir === '' ? '{workspaceRoot}' : '{projectRoot}';
  const inputs = dirInputs(prefix);
  if (ctx.goWorkFile === null) return inputs;
  inputs.push(
    `{workspaceRoot}/${ctx.goWorkFile}`,
    `{workspaceRoot}/${ctx.goWorkFile.replace(/[^/]+$/, 'go.work.sum')}`,
  );
  for (const dir of ctx.memberDirs ?? []) {
    if (dir === moduleDir) continue;
    const memberPrefix = dir === '' ? '{workspaceRoot}' : `{workspaceRoot}/${dir}`;
    inputs.push(...dirInputs(memberPrefix));
  }
  return inputs;
}

/**
 * The workspace-relative golangci config that applies to `moduleDir` —
 * golangci-lint searches from the working directory upward, so the
 * nearest config in the module dir or any ancestor up to the workspace
 * root wins. Returns null when none exists (no lint target is inferred).
 */
function findGolangciConfig(moduleDir: string, workspaceRoot: string): string | null {
  let dir = moduleDir;
  while (true) {
    for (const name of GOLANGCI_CONFIG_NAMES) {
      const rel = dir === '' ? name : `${dir}/${name}`;
      if (existsSync(join(workspaceRoot, rel))) return rel;
    }
    if (dir === '') return null;
    const parent = dirname(dir);
    dir = parent === '.' ? '' : parent;
  }
}
