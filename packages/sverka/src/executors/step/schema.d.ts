export interface StepExecutorSchema {
  /** Fully qualified sverka step id, e.g. `ci/lint`. */
  step: string
  /** sverka entry id that reaches the step. Default: the first entry that does. */
  entry?: string
  /** Path to the sverka config, relative to the workspace root. Default: the config in the project root. */
  config?: string
  /** Directory the step runs in, relative to the workspace root. Default: the project root. */
  cwd?: string
  /** Values for the sverka pipeline inputs. */
  inputs?: Record<string, string | number | boolean>
}
