/** Plugin options for `@nx-devkit/moon`. */
export interface NxDevkitMoonOptions {
  /**
   * Prefix prepended to every inferred target name — and to every
   * `deps`-derived `dependsOn` reference. moon task names are
   * project-scoped — each `tasks.<name>` key is local to its owning
   * moon.yml — so the default is `''` (the task's own name); set
   * `targetPrefix: 'moon:'` when another plugin collides.
   */
  targetPrefix?: string;
}
