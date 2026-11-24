/**
 * Plugin options for `@nx-devkit/python`. Each flag gates a family of
 * inferred targets; every flag defaults to `true`.
 */
export interface NxDevkitPythonOptions {
  /** Infer the `test` target when pytest is declared (default `true`). */
  test?: boolean;
  /** Infer `lint` and `fmt` targets when ruff is declared (default `true`). */
  lint?: boolean;
  /** Infer the `typecheck` target when ty or pyright is declared (default `true`). */
  typecheck?: boolean;
  /** Infer the `lock` target when uv or poetry is the manager (default `true`). */
  lock?: boolean;
}
