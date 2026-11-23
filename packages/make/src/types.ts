/** Plugin options for `@nx-devkit/make`. */
export interface NxDevkitMakeOptions {
  /** Target name prefix. Default: "make" → `make:build`, `make:clean`, … */
  targetPrefix?: string;
  /**
   * Cache inferred targets. Default: false — a Makefile gives no reliable
   * signal for which goals produce files (not even `.PHONY` covers it:
   * un-declared phony goals and mis-declared file goals both exist), so
   * caching is opt-in per workspace.
   */
  cache?: boolean;
}
