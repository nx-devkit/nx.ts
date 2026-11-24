import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { logger, type ExecutorContext } from '@nx/devkit';
import { parseDotenvKeys } from '../../dotenv.ts';

export interface CheckExecutorOptions {
  /** Workspace-relative `.env.example`/`.env.sample` files to verify. */
  examples: string[];
  /**
   * Workspace-relative env file checked in addition to process.env.
   * Default: the `.env` sibling of each example file.
   */
  envFile?: string;
}

export interface CheckExecutorResult {
  success: boolean;
  /** Missing var NAMES — never values. Present only on failure. */
  missing?: string[];
}

/**
 * Resolve a workspace-relative option path, or null when it is absolute
 * or escapes the workspace root. The schema rejects such paths up front;
 * this guard covers programmatic callers — invalid input fails loud.
 */
function resolveInside(workspaceRoot: string, path: string): string | null {
  if (isAbsolute(path)) return null;
  const abs = resolve(workspaceRoot, path);
  const rel = relative(workspaceRoot, abs);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return abs;
}

/**
 * Verify that every var a `.env.example`/`.env.sample` declares is
 * available — in `process.env` or in the resolved `.env` file.
 *
 * The check fails loud: a missing example file is an error (stale
 * inference or a deleted template, never a silent pass) and every
 * missing var is listed by name. Values are never read into the report —
 * a name is a key, a secret is a value.
 */
export async function checkExecutor(
  options: CheckExecutorOptions,
  context: ExecutorContext,
): Promise<CheckExecutorResult> {
  const workspaceRoot = context.root;
  const examples = options.examples ?? [];
  const missing = new Set<string>();
  let failed = false;

  for (const example of examples) {
    const exampleAbs = resolveInside(workspaceRoot, example);
    if (exampleAbs === null) {
      logger.error(`[dotenv] Example path must be workspace-relative: ${example}`);
      failed = true;
      continue;
    }
    if (!existsSync(exampleAbs)) {
      logger.error(`[dotenv] Required example file not found: ${example}`);
      failed = true;
      continue;
    }

    const envFileAbs =
      options.envFile !== undefined
        ? resolveInside(workspaceRoot, options.envFile)
        : join(dirname(exampleAbs), '.env');
    if (envFileAbs === null) {
      logger.error(`[dotenv] envFile must be a workspace-relative path: ${options.envFile}`);
      failed = true;
      continue;
    }
    const fileKeys = existsSync(envFileAbs)
      ? new Set(parseDotenvKeys(readFileSync(envFileAbs, 'utf8')))
      : new Set<string>();

    for (const key of parseDotenvKeys(readFileSync(exampleAbs, 'utf8'))) {
      // Own-property check: inherited names like `toString` or
      // `constructor` must not satisfy a required var.
      if (!Object.hasOwn(process.env, key) && !fileKeys.has(key)) {
        missing.add(key);
      }
    }
  }

  const sorted = [...missing].sort();
  if (sorted.length > 0) {
    logger.error(
      `[dotenv] env check failed — ${sorted.length} required var(s) missing:\n` +
        sorted.map((key) => `  - ${key}`).join('\n') +
        '\nSet them in the environment or in the project .env file.',
    );
  }
  if (failed || sorted.length > 0) {
    return sorted.length > 0 ? { success: false, missing: sorted } : { success: false };
  }
  return { success: true };
}

export default checkExecutor;
