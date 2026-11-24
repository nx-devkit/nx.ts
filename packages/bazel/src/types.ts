/**
 * Plugin options for `@nx-devkit/bazel`.
 */
export interface NxDevkitBazelOptions {
  /**
   * Prefix for inferred target names. Default: `"bazel"` →
   * `bazel:build`, `bazel:test`.
   */
  targetPrefix?: string;
}
