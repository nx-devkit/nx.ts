import { logger } from '@nx/devkit';
import type { TargetConfiguration } from '@nx/devkit';
import type { DaggerJson } from './dagger-config.ts';
import { logSafe } from './log-safe.ts';

/** Everything a dagger.json → target mapping needs beyond the config itself. */
export interface DaggerTargetContext {
  /** Target name prefix (`dagger` by default). */
  prefix: string;
  /** Workspace-relative path of the dagger.json the targets came from. */
  configFile: string;
  /** Module source filesets — `src/**`, a declared `source`, or the module root. */
  sourceInputs: string[];
}

/**
 * Map a dagger.json onto `dagger call` targets.
 *
 * Declared `functions` produce one `<prefix>:call:<fn>` target each —
 * `dagger functions` cannot be listed at inference time, so the module
 * spells its callables out. Without `functions` a single `<prefix>:call`
 * target runs the bare `dagger call`.
 *
 * Every target is `cache: false` — dagger calls run real pipelines with
 * side effects — but inputs stay tracked so the project graph and
 * `affected` still see config and source edits.
 */
export function buildCallTargets(
  config: DaggerJson,
  ctx: DaggerTargetContext,
): Record<string, TargetConfiguration> {
  const inputs = [...ctx.sourceInputs, `{workspaceRoot}/${ctx.configFile}`];
  const targets: Record<string, TargetConfiguration> = Object.create(null);

  const seen = new Map<string, string>();
  for (const fn of config.functions) {
    const segment = targetSegment(fn);
    if (segment === '') {
      logger.warn(
        `[dagger] Function ${logSafe(JSON.stringify(fn))} has no usable target name — it is skipped`,
      );
      continue;
    }
    const claimedBy = seen.get(segment);
    if (claimedBy !== undefined) {
      // Two distinct names collapse to one segment — never silently drop.
      logger.warn(
        `[dagger] Function ${logSafe(JSON.stringify(fn))} collides with ${logSafe(
          JSON.stringify(claimedBy),
        )} on target ${ctx.prefix}:call:${segment} — the later name is skipped`,
      );
      continue;
    }
    const arg = shellQuote(fn);
    if (arg === null) {
      logger.warn(
        `[dagger] Function ${logSafe(JSON.stringify(fn))} cannot be quoted safely on this platform — it is skipped`,
      );
      continue;
    }
    seen.set(segment, fn);
    targets[`${ctx.prefix}:call:${segment}`] = callTarget(`dagger call ${arg}`, inputs);
  }

  if (seen.size === 0) {
    targets[`${ctx.prefix}:call`] = callTarget('dagger call', inputs);
  }
  return targets;
}

function callTarget(command: string, inputs: string[]): TargetConfiguration {
  return {
    executor: 'nx:run-commands',
    options: { command, cwd: '{projectRoot}' },
    cache: false,
    inputs,
  };
}

/**
 * A declared function name becomes one target-name segment. Characters
 * outside `[A-Za-z0-9_-]` fold to `-` so `unit test` → `unit-test`.
 */
export function targetSegment(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * `nx:run-commands` goes through a shell — quote the name so a declared
 * function can never inject shell syntax. The command is emitted for the
 * platform running inference: POSIX shells single-quote; cmd.exe has no
 * single-quote and still expands `%VAR%` inside double quotes, so on
 * Windows a name containing `"`, `%`, `!`, or control characters cannot
 * be quoted safely and returns `null` — the caller warns and skips it.
 */
export function shellQuote(value: string): string | null {
  if (process.platform === 'win32') {
    // eslint-disable-next-line no-control-regex -- control chars are exactly what we reject
    return /["%!]/.test(value) || /[\x00-\x1f\x7f-\x9f]/.test(value) ? null : `"${value}"`;
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
