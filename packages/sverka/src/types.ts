/**
 * Options for the `@nx-devkit/sverka` plugin.
 *
 * The plugin turns a sverka config into one Nx target per sverka step, so
 * every step keeps its own inputs, outputs and cache entry instead of
 * collapsing into a single "run everything" target.
 */
export interface NxDevkitSverkaOptions {
  /**
   * Restrict inference to a single sverka entry (e.g. `"ci/on-push"`).
   *
   * Default: every entry in the config — each entry contributes the steps
   * it can reach, so a step shared by two entries is inferred once.
   */
  entry?: string

  /**
   * Target name template.
   *
   * Tokens: `{pipeline}` (sverka pipeline id), `{step}` (sverka step id),
   * `{id}` (the fully qualified step id, e.g. `ci/lint`).
   * Default: `"{pipeline}:{step}"` — e.g. `ci:lint`.
   */
  targetName?: string

  /**
   * Extra input globs appended to every inferred target.
   *
   * Use for files the step reads that live outside the project root
   * (e.g. a workspace-wide lockfile).
   */
  inputs?: string[]

  /**
   * Cache the inferred targets. Default: `true`.
   *
   * Nx caches each target separately — a step whose inputs did not change
   * is restored from the cache instead of re-running.
   */
  cache?: boolean
}

/** Default target name template. */
export const DEFAULT_TARGET_NAME = '{pipeline}:{step}'
