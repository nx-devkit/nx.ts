/** Plugin options for `@nx-devkit/dagger`. */
export interface NxDevkitDaggerOptions {
  /**
   * Prefix for inferred target names. Default `dagger` → `dagger:call`
   * and `dagger:call:<function>`.
   */
  targetPrefix?: string;
}
