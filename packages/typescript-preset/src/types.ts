export interface NxDevkitTypescriptOptions {
  tsgo?: boolean;
  configFile?: string;
  clean?: boolean;
  /** Infer `test:tap` target using the TAP reporter. Default: false. */
  tap?: boolean;
  /** Infer `test:coverage` target for the native Node test runner. Default: false. */
  coverage?: boolean;
  /** Infer `lint` target from `.oxlintrc.*`. Default: true. */
  oxlint?: boolean;
  /** Infer `lint` target from `eslint.config.*`. Default: true. */
  eslint?: boolean;
  /** Infer `format`/`format-check`/`lint` from `biome.json`. Default: true. */
  biome?: boolean;
  /** Infer `format`/`format-check` from `.oxfmtrc.*`/`oxfmt.config.*`. Default: true. */
  oxfmt?: boolean;
  /** Infer `build` target from `tsdown.config.*` or a publishable `package.json` + `src/index.ts`. Default: true. */
  tsdown?: boolean;
  /** Glob for native test files. Default: double-star-slash-star.test.ts-js-mts-mjs. */
  testGlob?: string;
  /** Glob for spec files. Default: double-star-slash-star.spec.ts-js-mts-mjs. */
  specGlob?: string;
  /**
   * Emit an atomized CI test group (Nx Atomizer style): a `test-ci` group
   * target plus one `test-ci--<file>` target per test/spec file, so DTE can
   * shard individual files. `true` names the group `test-ci`; a string
   * overrides the group name. Applies to both the Vitest and the native
   * Node test runner inference. Default: false.
   */
  testCi?: boolean | string;
  /** Infer targets for the workspace root itself (single-package repos). Default: false. */
  includeRoot?: boolean;
}
