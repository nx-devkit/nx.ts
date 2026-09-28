export interface DepConstraint {
  /** Tag present on the importing project for this constraint to apply. */
  sourceTag: string
  /** Tags the imported project must share at least one of. */
  onlyDependOnLibsWithTags: string[]
}

export interface NxBoundariesOptions {
  depConstraints?: DepConstraint[]
  /** Target name inferred on the root project. Default: "check-boundaries". */
  targetName?: string
}
