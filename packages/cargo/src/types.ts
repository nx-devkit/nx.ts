/**
 * Plugin options for `@nx-devkit/cargo`.
 */
export interface NxDevkitCargoOptions {
  /**
   * Infer a `clippy` target (`cargo clippy -p <name> -- -D warnings`)
   * on every crate. Default: true.
   */
  clippy?: boolean;
  /**
   * Infer a `fmt` target (`cargo fmt -p <name> -- --check`) on every
   * crate. Default: true.
   */
  fmt?: boolean;
}
