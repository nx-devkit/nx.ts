/** Plugin options for `@nx-devkit/git-hooks`. */
export interface NxDevkitGitHooksOptions {
  /**
   * Target name prefix. Default `"hooks"` → `hooks:install`, `hooks:run`,
   * `hooks:<hook-name>`.
   */
  targetPrefix?: string;
}
