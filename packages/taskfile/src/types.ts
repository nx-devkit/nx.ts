/** Plugin options for `@nx-devkit/taskfile`. */
export interface NxDevkitTaskfileOptions {
  /**
   * Prefix for inferred target names. The default `task` produces targets
   * like `task:build` (and `task:lib:gen` for included namespaces). An
   * empty string emits the task CLI name verbatim.
   */
  targetPrefix?: string;
  /**
   * Opt into Nx caching for inferred targets. Off by default — task
   * commands are arbitrary and the plugin cannot see their file inputs —
   * so caching is an explicit consumer choice.
   */
  cache?: boolean;
}
