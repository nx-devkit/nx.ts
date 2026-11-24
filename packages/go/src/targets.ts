import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TargetConfiguration } from '@nx/devkit';

/** golangci-lint auto-discovers these config names from the working dir upward. */
export const GOLANGCI_CONFIG_NAMES = ['.golangci.yml', '.golangci.yaml', '.golangci.json'] as const;

/** Everything a module dir → target mapping needs beyond the dir itself. */
export interface ModuleTargetContext {
  /** Absolute workspace root — used only for golangci config detection. */
  workspaceRoot: string;
  /**
   * Workspace-relative path of the go.work claiming the module, or null for
   * a standalone module. Members hash the work file (and go.work.sum) so
   * workspace edits re-hash their targets.
   */
  goWorkFile: string | null;
  /** Whether to infer the golangci-lint `lint` target (options.lint). */
  lint: boolean;
}

/** Every target shares the module's own source hash. */
const MODULE_INPUTS = ['{projectRoot}/go.mod', '{projectRoot}/go.sum', '{projectRoot}/**/*.go'];

/**
 * Module dir → build/test/vet/lint targets. Commands run with
 * `cwd: '{projectRoot}'` — `go` and `golangci-lint` both resolve their
 * config and module context from the working directory, so no flags are
 * ever interpolated. lint appears only when `options.lint` allows it and
 * a `.golangci.{yml,yaml,json}` exists in the module dir or the workspace
 * root (golangci-lint searches upward).
 */
export function buildModuleTargets(
  moduleDir: string,
  ctx: ModuleTargetContext,
): Record<string, TargetConfiguration> {
  const inputs = buildInputs(ctx);
  const targets: Record<string, TargetConfiguration> = {
    build: cachedTarget('go build ./...', inputs),
    test: cachedTarget('go test ./...', inputs),
    vet: cachedTarget('go vet ./...', inputs),
  };

  if (ctx.lint) {
    const config = findGolangciConfig(moduleDir, ctx.workspaceRoot);
    if (config !== null) {
      targets['lint'] = cachedTarget('golangci-lint run ./...', [
        ...inputs,
        `{workspaceRoot}/${config}`,
      ]);
    }
  }
  return targets;
}

function cachedTarget(command: string, inputs: string[]): TargetConfiguration {
  return {
    executor: 'nx:run-commands',
    cache: true,
    inputs,
    options: { command, cwd: '{projectRoot}' },
  };
}

/**
 * Module sources plus — for workspace members — the go.work and the
 * go.work.sum sitting next to it (`<dir>/go.work` → `<dir>/go.work.sum`,
 * `go.work` → `go.work.sum`). Workspace resolution changes the build graph
 * without touching go.mod, so the work files must participate in the hash.
 */
function buildInputs(ctx: ModuleTargetContext): string[] {
  if (ctx.goWorkFile === null) return [...MODULE_INPUTS];
  return [
    ...MODULE_INPUTS,
    `{workspaceRoot}/${ctx.goWorkFile}`,
    `{workspaceRoot}/${ctx.goWorkFile.replace(/[^/]+$/, 'go.work.sum')}`,
  ];
}

/**
 * The workspace-relative golangci config that applies to `moduleDir` — the
 * module's own config wins, the workspace-root one is the fallback. Returns
 * null when neither exists (no lint target is inferred then).
 */
function findGolangciConfig(moduleDir: string, workspaceRoot: string): string | null {
  for (const base of [moduleDir, '']) {
    for (const name of GOLANGCI_CONFIG_NAMES) {
      const rel = base === '' ? name : `${base}/${name}`;
      if (existsSync(join(workspaceRoot, rel))) return rel;
    }
  }
  return null;
}
