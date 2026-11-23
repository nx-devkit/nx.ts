import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { nodeModulesDirs, resolveBinLaunch } from '@nx-devkit/internal';

export interface TypecheckExecutorOptions {
  /** Prefer the native TypeScript compiler (tsgo from @typescript/native-preview, or the native `tsc` from typescript@7 / @typescript/native). Default: true. */
  tsgo?: boolean;
  /** Name of the tsconfig file to build. Default: "tsconfig.json". */
  configFile?: string;
  /** Pre-clean the tsbuildinfo before building. Default: false. */
  clean?: boolean;
}

export interface TypecheckExecutorResult {
  success: boolean;
}

interface NxExecutorContext {
  root: string;
  projectName?: string;
  projectsConfigurations?: { projects?: Record<string, { root?: string }> };
}

export interface CompilerSelection {
  bin: 'tsc' | 'tsgo';
  packageName: 'typescript' | '@typescript/native' | '@typescript/native-preview';
}

// `tsgo` exists only in the legacy @typescript/native-preview package.
// Under the MS-recommended typescript@7 side-by-side alias
// (@typescript/native = npm:typescript@7) the native compiler is exposed
// as `tsc` from that package — `typescript` itself stays on the classic
// line for the programmatic API consumers (Nx project graph, editors,
// typescript-eslint) still depend on.
export function detectCompiler(
  workspaceRoot: string,
  projectRoot: string,
  preferNative: boolean,
): CompilerSelection {
  if (preferNative) {
    if (hasPackage(workspaceRoot, projectRoot, '@typescript/native')) {
      return { bin: 'tsc', packageName: '@typescript/native' };
    }
    if (hasPackage(workspaceRoot, projectRoot, '@typescript/native-preview')) {
      return { bin: 'tsgo', packageName: '@typescript/native-preview' };
    }
  }
  return { bin: 'tsc', packageName: 'typescript' };
}

function hasPackage(workspaceRoot: string, projectRoot: string, name: string): boolean {
  // Search the same ancestor node_modules dirs resolveBinLaunch uses —
  // hoisted installs live between the project and workspace roots, or
  // above the workspace root in nested workspaces.
  const dirs = new Set([...nodeModulesDirs(projectRoot), ...nodeModulesDirs(workspaceRoot)]);
  for (const nmDir of dirs) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed package name joined under node_modules
    if (existsSync(join(nmDir, name))) return true;
  }
  return false;
}

// tsc can emit more than execFile's 1 MiB default maxBuffer of
// diagnostics on a failed typecheck — truncating the output would hide
// the real compiler errors.
const MAX_BUFFER = 16 * 1024 * 1024;
// Bound each compiler launch so a stalled tsc/tsgo can't pend the Nx
// task forever.
const EXEC_TIMEOUT = 10 * 60 * 1000;

/**
 * Typecheck executor for `@nx-devkit/typescript:typecheck`.
 *
 * Runs `tsc --build` or `tsgo --build` via `execFile` (no shell) so the
 * command is not vulnerable to shell injection. Falls back to `tsc`
 * when `tsgo` is requested but not installed.
 *
 * When `clean` is true, runs `tsc --build --clean` first (which removes
 * stale .tsbuildinfo files without building), then `tsc --build`.
 */
export async function typecheckExecutor(
  options: TypecheckExecutorOptions,
  context: NxExecutorContext,
): Promise<TypecheckExecutorResult> {
  const tsgo = options.tsgo ?? true;
  const configFile = options.configFile ?? 'tsconfig.json';
  const clean = options.clean ?? false;

  const workspaceRoot = context.root;
  const projectName = context.projectName ?? '';
  const projects = context.projectsConfigurations?.projects ?? {};
  // eslint-disable-next-line security/detect-object-injection -- projectName comes from the Nx executor context
  const projectConfig = Object.hasOwn(projects, projectName) ? projects[projectName] : undefined;
  if (projectConfig === undefined) {
    console.error(
      `[nx-devkit/typecheck] Project "${projectName}" not found in projectsConfigurations — refusing to typecheck the workspace root`,
    );
    return { success: false };
  }
  const projectRoot = projectConfig.root;
  const absProjectRoot = resolve(workspaceRoot, projectRoot);
  const configPath = join(absProjectRoot, configFile);

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- config filename comes from executor schema options joined to the project root
  if (!existsSync(configPath)) {
    console.error(`[nx-devkit/typecheck] Config not found: ${configPath}`);
    return { success: false };
  }

  // Pick the compiler to run: native `tsc` from @typescript/native when
  // present, then legacy `tsgo`, then `tsc` from `typescript` — which under
  // the side-by-side scheme is TypeScript 6 (classic), not the native
  // compiler. Look in both the project root and the workspace root — a
  // project-local install is valid.
  const { bin, packageName } = detectCompiler(workspaceRoot, absProjectRoot, tsgo);

  // Resolve the compiler through the owning package's `bin` field and
  // launch Node scripts via process.execPath — `.bin` shims are shell
  // scripts / `.cmd` wrappers that cannot run with `shell: false`
  // (and cannot run at all on Windows). Falls back to the bare name so
  // the system PATH can still be used.
  const launch = resolveBinLaunch(bin, packageName, absProjectRoot, workspaceRoot);

  // Clean phase: `tsc --build --clean` removes stale build info.
  // This does NOT build — it only cleans.
  if (clean) {
    await new Promise<void>((resolvePromise) => {
      execFile(
        launch.command,
        [...launch.prependArgs, '--build', '--clean', configFile],
        { cwd: absProjectRoot, shell: false, maxBuffer: MAX_BUFFER, timeout: EXEC_TIMEOUT },
        (err, _stdout, stderr) => {
          if (err) {
            // A non-zero clean is usually "no build info yet", but
            // surface it so real problems (bad tsconfig, permissions,
            // missing binary) aren't silently masked.
            console.error(
              `[nx-devkit/typecheck] clean phase failed in ${absProjectRoot}: ${err.message} — continuing to build`,
            );
            if (stderr) console.error(`[nx-devkit/typecheck] stderr: ${stderr}`);
          }
          resolvePromise();
        },
      );
    });
  }

  // Build phase: `tsc --build` compiles the project.
  return new Promise<TypecheckExecutorResult>((resolvePromise) => {
    execFile(
      launch.command,
      [...launch.prependArgs, '--build', configFile],
      { cwd: absProjectRoot, shell: false, maxBuffer: MAX_BUFFER, timeout: EXEC_TIMEOUT },
      (err, stdout, stderr) => {
        if (err) {
          console.error(
            `[nx-devkit/typecheck] ${bin} --build ${configFile} failed in ${absProjectRoot}`,
          );
          console.error(`[nx-devkit/typecheck] error: ${err.message}`);
          if (stdout) console.error(`[nx-devkit/typecheck] stdout: ${stdout}`);
          if (stderr) console.error(`[nx-devkit/typecheck] stderr: ${stderr}`);
          resolvePromise({ success: false });
          return;
        }
        resolvePromise({ success: true });
      },
    );
  });
}

export default typecheckExecutor;
