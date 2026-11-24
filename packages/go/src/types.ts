/** Plugin options for `@nx-devkit/go`. */
export interface NxDevkitGoOptions {
  /**
   * Infer a `lint` target (`golangci-lint run ./...`) on every module whose
   * directory or the workspace root carries a `.golangci.{yml,yaml,json}`
   * config. Default: `true`.
   */
  lint?: boolean;
}
