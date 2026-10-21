/**
 * Stable, workspace-visible locations for sverka step outputs.
 *
 * The sverka engine keeps artifacts in a per-run directory
 * (`<artifactDir>/<runId>/<stepId>/<output>`), which cannot be cached by Nx:
 * the path changes on every run and two targets never share it. Nx needs
 * stable paths, so the executor copies engine artifacts into a per-step
 * directory inside the project:
 *
 * ```text
 * <projectRoot>/.sverka/artifacts/<stepId>/<output>      # artifact outputs
 * <projectRoot>/.sverka/artifacts/<stepId>/values/<name> # value outputs
 * ```
 *
 * The plugin declares those paths as the target's `outputs`, and the
 * consuming step declares them as its `inputs` — Nx then caches and
 * restores them between the two targets.
 */

/** Directory (relative to the project root) holding bridged sverka artifacts. */
export const ARTIFACTS_DIR = '.sverka/artifacts'

/** Relative path of a step's artifact output. */
export function artifactRelativePath(stepId: string, outputName: string): string {
  return `${ARTIFACTS_DIR}/${stepId}/${outputName}`
}

/** Relative path of a step's value output. */
export function valueRelativePath(stepId: string, outputName: string): string {
  return `${ARTIFACTS_DIR}/${stepId}/values/${outputName}`
}

/** Relative path of a step's artifact directory. */
export function stepArtifactsRelativeDir(stepId: string): string {
  return `${ARTIFACTS_DIR}/${stepId}`
}

/**
 * Map every declared output of a step to the stable path the executor
 * writes it to.
 *
 * - artifact with a `path`  → the file the step writes in the workspace
 * - artifact from stdout   → the bridged artifact directory
 * - value output            → the bridged value directory
 */
export function stableOutputPaths(
  stepId: string,
  outputs: readonly { name: string; type: string; path?: string; fromStdout?: boolean }[],
): Record<string, string> {
  const paths: Record<string, string> = {}
  for (const output of outputs) {
    if (output.path) {
      paths[output.name] = output.path
    } else if (output.fromStdout) {
      paths[output.name] = artifactRelativePath(stepId, output.name)
    } else {
      paths[output.name] = valueRelativePath(stepId, output.name)
    }
  }
  return paths
}
