/** Plugin options for `@nx-devkit/just`. */
export interface NxDevkitJustOptions {
  /**
   * Prefix prepended to every inferred target name. Default `just:` —
   * recipe `build` becomes target `just:build`, module recipe
   * `tools::check` becomes `just:tools::check`.
   */
  targetPrefix?: string;
}
