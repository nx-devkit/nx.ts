/** Plugin options for `@nx-devkit/moon`. */
export interface NxDevkitMoonOptions {
  /**
   * Prefix prepended to every inferred target name — and to every
   * `deps`-derived `dependsOn` reference. moon task names are already
   * project-qualified, so the default is `''` (same name); set
   * `targetPrefix: 'moon:'` when another plugin collides.
   */
  targetPrefix?: string;
}
