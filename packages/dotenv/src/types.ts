/** Plugin options for `@nx-devkit/dotenv`. */
export interface NxDevkitDotenvOptions {
  /** Name of the inferred check target. Default: `env:check`. */
  targetName?: string;
  /**
   * Workspace-relative env file the check reads instead of each example's
   * `.env` sibling. Passed through to the executor and added to the
   * target's inputs so edits bust the cache.
   */
  envFile?: string;
}
