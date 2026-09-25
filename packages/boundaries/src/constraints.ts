import type { DepConstraint } from './types.ts'

/**
 * Official-rule semantics: every constraint whose `sourceTag` matches the
 * importing project's tags must be satisfied — the target project must share
 * at least one tag with `onlyDependOnLibsWithTags`. An empty allowlist means
 * "may depend only on untagged projects". No matching constraint → allowed
 * (permissive default).
 */
export function isAllowed(
  sourceTags: string[],
  targetTags: string[],
  constraints: DepConstraint[],
): boolean {
  return constraints
    .filter((c) => sourceTags.includes(c.sourceTag))
    .every((c) =>
      c.onlyDependOnLibsWithTags.length === 0
        ? targetTags.length === 0
        : targetTags.some((t) => c.onlyDependOnLibsWithTags.includes(t)),
    )
}
